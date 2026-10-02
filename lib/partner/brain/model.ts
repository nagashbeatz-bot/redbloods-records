/**
 * Sunny Brain v1 — row model + derived lifecycle state. Pure (no DB, no IO).
 *
 * Layers (never mixed): RESOURCES (what was observed) · AUTHORIZATIONS (what the Owner allowed Sunny to track — the
 * security boundary) · OBSERVATIONS (one value about one subject at one time — never an inference) · INTEL RECORDS
 * (INSIGHT / RECOMMENDATION — Sunny's inference, never an Owner fact) · LINKS (the evidence graph) · EVENTS (the ONE
 * lifecycle log) · T2 APPROVAL REQUESTS / DECISIONS (what Sunny asked the Owner, and what he decided in Redbloods).
 *
 * Current state is DERIVED from the append-only events (latest by seq), exactly as the DB views do. reviewAt (here) =
 * review_at (DB): read-only context — never an automatic review, expiry or reminder. History is never current state.
 * Never mapped: approval_ref / request_key / payload_hash (internal), decided_by (an auth user id), requested_client.
 */
import { UUID_RE } from "./vocab";

export const BRAIN_TABLES = {
  resources: "sunny_resources", authorizations: "sunny_tracking_authorizations", observations: "sunny_observations",
  records: "sunny_intel_records", links: "sunny_brain_links", events: "sunny_brain_events",
  requests: "owner_approval_requests", decisions: "owner_approval_decisions",
} as const;
export const BRAIN_COLUMNS = {
  resources: "id,platform,resource_kind,content_kind,parent_id,identity_key,first_handle,canonical_url,display_name,external_actor,approval_basis,authorization_id,created_at",
  authorizations: "id,purpose_kind,purpose_he,resource_ids,include_child_resources,entity_keys,observation_families,source_kinds,insights_allowed,recommendations_allowed,max_observations_per_day,valid_from,valid_until,supersedes_id,approval_ref,created_at",
  observations: "id,seq,batch_id,resource_id,entity_key,observation_type,value_num,value_text,value_bool,unit,observed_at,period_start,period_end,source_type,source_kind,source_ref,capture_method,confidence,approval_basis,authorization_id,corrects_id,created_at",
  records: "id,seq,record_type,entity_keys,resource_ids,topic,area,title_he,body,source_type,confidence,review_at,supersedes_id,authorization_id,created_at",
  links: "id,role,from_record_id,from_observation_id,from_ref,to_record_id,to_resource_id,to_ref,note_he,authorization_id,created_at",
  events: "id,seq,record_id,observation_id,authorization_id,resource_id,link_id,from_status,to_status,reason_he,actor,approval_basis,created_at",
  requests: "id,seq,kind,requested_payload,payload_hash,summary_he,risk_he,requested_via,request_expires_at,created_at",
  decisions: "id,request_id,decision,approved_payload,narrowed,decided_role,reason_he,result_ref,created_at",
} as const;

export interface BrainResource { id: string; platform: string; resourceKind: string; contentKind: string | null; parentId: string | null; identityKey: string; firstHandle: string | null; canonicalUrl: string | null; displayName: string | null; externalActor: string | null; approvalBasis: string; authorizationId: string | null; createdAt: string }
export interface BrainAuthorization { id: string; purposeKind: string; purposeHe: string; resourceIds: string[]; includeChildResources: boolean; entityKeys: string[]; observationFamilies: string[]; sourceKinds: string[]; insightsAllowed: boolean; recommendationsAllowed: boolean; maxObservationsPerDay: number | null; validFrom: string; validUntil: string | null; supersedesId: string | null; approvalRequestId: string | null; createdAt: string }
export interface BrainObservation { id: string; seq: number; batchId: string; resourceId: string | null; entityKey: string | null; type: string; valueNum: number | null; valueText: string | null; valueBool: boolean | null; unit: string | null; observedAt: string; periodStart: string | null; periodEnd: string | null; sourceType: string; sourceKind: string; sourceRef: string | null; captureMethod: string; confidence: string; approvalBasis: string; authorizationId: string | null; correctsId: string | null; createdAt: string }
export interface BrainRecord { id: string; seq: number; recordType: string; entityKeys: string[]; resourceIds: string[]; topic: string | null; area: string; titleHe: string; body: Record<string, unknown>; sourceType: string; confidence: string; reviewAt: string | null; supersedesId: string | null; authorizationId: string; createdAt: string }
export interface BrainLink { id: string; role: string; fromRecordId: string | null; fromObservationId: string | null; fromRef: string | null; toRecordId: string | null; toResourceId: string | null; toRef: string | null; noteHe: string | null; authorizationId: string; createdAt: string }
export interface BrainEvent { id: string; seq: number; recordId: string | null; observationId: string | null; authorizationId: string | null; resourceId: string | null; linkId: string | null; fromStatus: string | null; toStatus: string; reasonHe: string | null; actor: "OWNER" | "SUNNY"; approvalBasis: string; createdAt: string }
export interface ApprovalRequest { id: string; seq: number; kind: string; payload: Record<string, unknown>; payloadHash: string; summaryHe: string; riskHe: string; requestedVia: string; expiresAt: string | null; createdAt: string }
export interface ApprovalDecision { id: string; requestId: string; decision: "APPROVED" | "REJECTED" | "CANCELLED"; approvedPayload: Record<string, unknown> | null; narrowed: boolean; decidedRole: string; reasonHe: string | null; resultRef: string | null; createdAt: string }

export interface BrainSnapshot {
  resources: BrainResource[]; authorizations: BrainAuthorization[]; observations: BrainObservation[]; records: BrainRecord[];
  links: BrainLink[]; events: BrainEvent[];
  /** null = the T2 approval queue is not installed / unreadable (the Brain is still readable). */
  approvals: { requests: ApprovalRequest[]; decisions: ApprovalDecision[] } | null;
  /** true when a bounded read hit its row cap (the view says it is partial). */
  truncated: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const id = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);
type Row = Record<string, unknown>;

export function mapResource(r: Row): BrainResource | null {
  const i = id(r.id), p = str(r.platform), k = str(r.resource_kind), ik = str(r.identity_key), b = str(r.approval_basis), c = str(r.created_at);
  if (!i || !p || !k || !ik || !b || !c) return null;
  return { id: i, platform: p, resourceKind: k, contentKind: str(r.content_kind), parentId: id(r.parent_id), identityKey: ik, firstHandle: str(r.first_handle), canonicalUrl: str(r.canonical_url), displayName: str(r.display_name), externalActor: str(r.external_actor), approvalBasis: b, authorizationId: id(r.authorization_id), createdAt: c };
}
export function mapAuthorization(r: Row): BrainAuthorization | null {
  const i = id(r.id), pk = str(r.purpose_kind), ph = str(r.purpose_he), vf = str(r.valid_from), c = str(r.created_at);
  if (!i || !pk || !ph || !vf || !c || bool(r.include_child_resources) === null || bool(r.insights_allowed) === null || bool(r.recommendations_allowed) === null) return null;
  const ref = str(r.approval_ref);
  return {
    id: i, purposeKind: pk, purposeHe: ph, resourceIds: strs(r.resource_ids), includeChildResources: r.include_child_resources as boolean, entityKeys: strs(r.entity_keys),
    observationFamilies: strs(r.observation_families), sourceKinds: strs(r.source_kinds), insightsAllowed: r.insights_allowed as boolean, recommendationsAllowed: r.recommendations_allowed as boolean,
    maxObservationsPerDay: num(r.max_observations_per_day), validFrom: vf.slice(0, 10), validUntil: str(r.valid_until)?.slice(0, 10) ?? null, supersedesId: id(r.supersedes_id),
    approvalRequestId: ref && ref.startsWith("approval:") ? id(ref.slice(9)) : null, createdAt: c,
  };
}
export function mapObservation(r: Row): BrainObservation | null {
  const i = id(r.id), s = num(r.seq), b = id(r.batch_id), t = str(r.observation_type), oa = str(r.observed_at), st = str(r.source_type), sk = str(r.source_kind), cm = str(r.capture_method), cf = str(r.confidence), ab = str(r.approval_basis), c = str(r.created_at);
  if (!i || s === null || !b || !t || !oa || !st || !sk || !cm || !cf || !ab || !c) return null;
  return { id: i, seq: s, batchId: b, resourceId: id(r.resource_id), entityKey: str(r.entity_key), type: t, valueNum: num(r.value_num), valueText: str(r.value_text), valueBool: bool(r.value_bool), unit: str(r.unit), observedAt: oa, periodStart: str(r.period_start), periodEnd: str(r.period_end), sourceType: st, sourceKind: sk, sourceRef: str(r.source_ref), captureMethod: cm, confidence: cf, approvalBasis: ab, authorizationId: id(r.authorization_id), correctsId: id(r.corrects_id), createdAt: c };
}
export function mapRecord(r: Row): BrainRecord | null {
  const i = id(r.id), s = num(r.seq), t = str(r.record_type), a = str(r.area), th = str(r.title_he), b = obj(r.body), st = str(r.source_type), cf = str(r.confidence), au = id(r.authorization_id), c = str(r.created_at);
  if (!i || s === null || !t || !a || !th || !b || !st || !cf || !au || !c) return null;
  return { id: i, seq: s, recordType: t, entityKeys: strs(r.entity_keys), resourceIds: strs(r.resource_ids), topic: str(r.topic), area: a, titleHe: th, body: b, sourceType: st, confidence: cf, reviewAt: str(r.review_at)?.slice(0, 10) ?? null, supersedesId: id(r.supersedes_id), authorizationId: au, createdAt: c };
}
export function mapLink(r: Row): BrainLink | null {
  const i = id(r.id), ro = str(r.role), au = id(r.authorization_id), c = str(r.created_at);
  if (!i || !ro || !au || !c) return null;
  return { id: i, role: ro, fromRecordId: id(r.from_record_id), fromObservationId: id(r.from_observation_id), fromRef: str(r.from_ref), toRecordId: id(r.to_record_id), toResourceId: id(r.to_resource_id), toRef: str(r.to_ref), noteHe: str(r.note_he), authorizationId: au, createdAt: c };
}
export function mapEvent(r: Row): BrainEvent | null {
  const i = id(r.id), s = num(r.seq), to = str(r.to_status), a = str(r.actor), b = str(r.approval_basis), c = str(r.created_at);
  if (!i || s === null || !to || (a !== "OWNER" && a !== "SUNNY") || !b || !c) return null;
  return { id: i, seq: s, recordId: id(r.record_id), observationId: id(r.observation_id), authorizationId: id(r.authorization_id), resourceId: id(r.resource_id), linkId: id(r.link_id), fromStatus: str(r.from_status), toStatus: to, reasonHe: str(r.reason_he), actor: a, approvalBasis: b, createdAt: c };
}
export function mapRequest(r: Row): ApprovalRequest | null {
  const i = id(r.id), s = num(r.seq), k = str(r.kind), p = obj(r.requested_payload), h = str(r.payload_hash), sh = str(r.summary_he), rh = str(r.risk_he), v = str(r.requested_via), c = str(r.created_at);
  if (!i || s === null || !k || !p || !h || !/^[0-9a-f]{64}$/.test(h) || !sh || !rh || !v || !c) return null;
  return { id: i, seq: s, kind: k, payload: p, payloadHash: h, summaryHe: sh, riskHe: rh, requestedVia: v, expiresAt: str(r.request_expires_at), createdAt: c };
}
export function mapDecision(r: Row): ApprovalDecision | null {
  const i = id(r.id), rq = id(r.request_id), d = str(r.decision), dr = str(r.decided_role), c = str(r.created_at);
  if (!i || !rq || (d !== "APPROVED" && d !== "REJECTED" && d !== "CANCELLED") || !dr || !c) return null;
  return { id: i, requestId: rq, decision: d, approvedPayload: obj(r.approved_payload), narrowed: r.narrowed === true, decidedRole: dr, reasonHe: str(r.reason_he), resultRef: str(r.result_ref), createdAt: c };
}

// ───────────────────────────── derived state (the same rules as the DB views / helpers) ─────────────────────────────

/** Latest event per target (by seq) — the current-state rule of sunny_intel_record_status. */
function latestBy<K extends keyof BrainEvent>(events: readonly BrainEvent[], key: K): Map<string, BrainEvent> {
  const m = new Map<string, BrainEvent>();
  for (const e of events) { const k = e[key] as unknown as string | null; if (!k) continue; const cur = m.get(k); if (!cur || e.seq > cur.seq) m.set(k, e); }
  return m;
}

export type AuthorizationState = "ACTIVE" | "NOT_YET_VALID" | "EXPIRED" | "REVOKED" | "SUPERSEDED";
export type ApprovalState = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";

export interface BrainState {
  recordStatus(id: string): string | null;
  recordHistory(id: string): BrainEvent[];
  observationValid(id: string): boolean;
  observationEnd(id: string): BrainEvent | null;
  resourceActive(id: string): boolean;
  linkActive(id: string): boolean;
  authorizationState(a: BrainAuthorization): AuthorizationState;
  authorizationEnd(id: string): BrainEvent | null;
  approvalState(r: ApprovalRequest): ApprovalState;
  decisionOf(requestId: string): ApprovalDecision | null;
}

/** todayIL = the Israel calendar day (the DB's sunny_today_il()); nowIso decides an expired pending request. */
export function brainState(s: BrainSnapshot, todayIL: string, nowIso: string): BrainState {
  const rec = latestBy(s.events, "recordId"), obs = latestBy(s.events, "observationId"), res = latestBy(s.events, "resourceId"), lnk = latestBy(s.events, "linkId"), auth = latestBy(s.events, "authorizationId");
  const decisions = new Map((s.approvals?.decisions ?? []).map((d) => [d.requestId, d]));
  return {
    recordStatus: (i) => rec.get(i)?.toStatus ?? null,
    recordHistory: (i) => s.events.filter((e) => e.recordId === i).sort((a, b) => a.seq - b.seq),
    observationValid: (i) => !obs.has(i),
    observationEnd: (i) => obs.get(i) ?? null,
    resourceActive: (i) => !res.has(i),
    linkActive: (i) => !lnk.has(i),
    authorizationEnd: (i) => auth.get(i) ?? null,
    authorizationState(a) {
      const end = auth.get(a.id);
      if (end) return end.toStatus === "SUPERSEDED" ? "SUPERSEDED" : "REVOKED";
      if (todayIL < a.validFrom) return "NOT_YET_VALID";
      if (a.validUntil && todayIL > a.validUntil) return "EXPIRED";
      return "ACTIVE";
    },
    decisionOf: (i) => decisions.get(i) ?? null,
    approvalState(r) {
      const d = decisions.get(r.id);
      if (d) return d.decision;
      return r.expiresAt && Date.parse(r.expiresAt) < Date.parse(nowIso) ? "EXPIRED" : "PENDING";
    },
  };
}
