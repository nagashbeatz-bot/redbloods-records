// Sunny Brain v1 + the T2 Owner approval queue — the ONE data path (lib/partner/brain/model.ts has the row model).
// WRITES go only through the applied SECURITY DEFINER RPCs:
//   service role (Sunny):   the 5 Brain wrappers + owner_approval_request / owner_approval_cancel
//   Owner SESSION client:   owner_approval_decide / owner_revoke_tracking_authorization / owner_brain_transition
//                           (the DB checks auth.uid() against owner_approval_principals; service_role has NO grant)
// READS are bounded SELECTs (service_role has SELECT only; anon / authenticated have none).
// Only lib/writes/brain.ts calls the write methods (scripts/test-sunny-brain.tsx pins it). Injectable client for tests.
import {
  BRAIN_COLUMNS, BRAIN_TABLES, mapAuthorization, mapDecision, mapEvent, mapLink, mapObservation, mapRecord, mapRequest, mapResource,
  type BrainSnapshot,
} from "./partner/brain/model";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type SelectResult = { data: unknown; error: { message: string; code?: string } | null };
export interface BrainRpcClient { rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> }
export interface BrainReadClient {
  from(table: string): { select(cols: string): { order(col: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<SelectResult> } } };
}

/** The refusal codes the RPCs raise (message prefix). Anything else = WRITE_FAILED (never reported as success). */
export const BRAIN_RPC_CODES = [
  // every RAISE code of the applied Brain + T2 SQL (longest first: OUTSIDE_AUTHORIZATION_SUBJECT before OUTSIDE_AUTHORIZATION)
  "PARENT_NOT_AN_ACCOUNT_OF_THIS_PLATFORM", "ACTED_ON_NEEDS_IMPLEMENTED_BY_LINK", "RECOMMENDATIONS_NOT_AUTHORIZED", "RECOMMENDATION_NEEDS_GROUNDING",
  "CORRECTS_REQUIRES_INVALIDATED", "LINK_TO_OWNER_MEMORY_RESERVED", "OUTSIDE_AUTHORIZATION_SUBJECT", "OUTSIDE_AUTHORIZATION_FAMILY",
  "OUTSIDE_AUTHORIZATION_SOURCE", "SOURCE_NOT_ALLOWED_FOR_BASIS", "AUTHORIZATION_OUT_OF_WINDOW", "AUTHORIZATION_NOT_ACTIVE",
  "INVALID_APPROVED_PAYLOAD", "AUTHORIZATION_DAILY_CAP", "AUTHORIZATION_NOT_FOUND", "BACKDATED_AUTHORIZATION", "INSIGHTS_NOT_AUTHORIZED",
  "AUTHORIZATION_REQUIRED", "INSIGHT_NEEDS_EVIDENCE", "INVALID_APPROVAL_BASIS", "OWNER_SESSION_REQUIRED", "SUPERSEDES_NOT_ALLOWED",
  "IDENTITY_KEY_MISMATCH", "OBSERVATION_NOT_FOUND", "OUTSIDE_AUTHORIZATION", "CONCURRENT_SUPERSEDE", "NEEDS_OWNER_APPROVAL", "SUPERSEDES_NOT_FOUND",
  "INVALID_TARGET_KIND", "RESOURCE_NOT_ACTIVE", "TYPE_NOT_AUTHORIZED", "ILLEGAL_TRANSITION", "REQUEST_KEY_REUSED", "RESOURCE_NOT_FOUND",
  "SEEN_HASH_MISMATCH", "SUPERSEDES_INVALID", "REQUEST_NOT_FOUND", "ENTITY_NOT_FOUND", "INVALID_DECISION", "LINK_NOT_ALLOWED", "RECORD_NOT_FOUND",
  "USE_OWNER_REVOKE", "ALREADY_DECIDED", "INVALID_PAYLOAD", "INVALID_REQUEST", "REASON_REQUIRED", "REQUEST_EXPIRED", "BASE_NOT_FOUND",
  "LINK_NOT_FOUND", "TOO_MANY_LINKS", "NOT_NARROWING", "REF_NOT_FOUND", "TYPE_RESERVED", "INVALID_ITEM", "APPEND_ONLY", "BATCH_SIZE", "STALE_BASE",
  "USE_CREATE",
] as const;
export type BrainRpcCode = (typeof BRAIN_RPC_CODES)[number];
export type BrainWrite = { status: "OK"; value: Record<string, unknown> } | { status: "REFUSED"; code: BrainRpcCode; detail: string } | { status: "NOT_INSTALLED"; detail: string } | { status: "WRITE_FAILED"; detail: string };

/** PostgREST "function / relation not found" — the migration is not applied yet (fail closed, never "empty"). */
const notInstalled = (e: { message: string; code?: string }) => e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42883" || e.code === "42P01" || /Could not find the (function|table)/i.test(e.message ?? "");

export function brainRefusal(e: { message: string; code?: string }): BrainWrite {
  if (notInstalled(e)) return { status: "NOT_INSTALLED", detail: (e.message ?? "").slice(0, 200) };
  const m = e.message ?? "";
  const code = BRAIN_RPC_CODES.find((c) => m === c || m.startsWith(`${c}:`) || m.startsWith(`${c} `));
  if (code) return { status: "REFUSED", code, detail: m.slice(0, 240) };
  // a role without EXECUTE (e.g. service_role on an Owner-only RPC) is a refusal, never a retryable failure
  if (e.code === "42501" || /permission denied for function/i.test(m)) return { status: "REFUSED", code: "OWNER_SESSION_REQUIRED", detail: m.slice(0, 240) };
  return { status: "WRITE_FAILED", detail: m.slice(0, 240) };
}

async function call(client: BrainRpcClient, fn: string, args: Record<string, unknown>): Promise<BrainWrite> {
  let r: RpcResult;
  try { r = await client.rpc(fn, args); } catch (e) { return { status: "WRITE_FAILED", detail: String((e as Error)?.message ?? e).slice(0, 200) }; }
  if (r.error) return brainRefusal(r.error);
  const d = Array.isArray(r.data) ? r.data[0] : r.data;
  return d && typeof d === "object" && !Array.isArray(d) ? { status: "OK", value: d as Record<string, unknown> } : { status: "WRITE_FAILED", detail: `${fn} returned no result` };
}

/** Service-role writes (Sunny). Each takes the authorization + request key the DB re-checks; no basis / actor / ref argument exists. */
export function createBrainServiceStore(client: BrainRpcClient) {
  return {
    registerContent: (a: { platform: string; contentKind: string; parentId: string; identityKey: string; canonicalUrl: string | null; displayName: string | null; authorizationId: string; requestKey: string }) =>
      call(client, "sunny_register_content", { p_platform: a.platform, p_content_kind: a.contentKind, p_parent_id: a.parentId, p_identity_key: a.identityKey, p_canonical_url: a.canonicalUrl, p_display_name: a.displayName, p_authorization_id: a.authorizationId, p_request_key: a.requestKey }),
    recordObservations: (a: { batchId: string; items: Record<string, unknown>[]; authorizationId: string; requestKey: string }) =>
      call(client, "sunny_record_observations", { p_batch_id: a.batchId, p_items: a.items, p_authorization_id: a.authorizationId, p_request_key: a.requestKey }),
    createIntelRecord: (a: { recordType: string; entityKeys: string[]; resourceIds: string[]; topic: string | null; area: string; titleHe: string; body: Record<string, unknown>; confidence: string; reviewAt: string | null; supersedesId: string | null; supersedeReason: string | null; links: Record<string, unknown>[]; authorizationId: string; requestKey: string }) =>
      call(client, "sunny_create_intel_record", { p_record_type: a.recordType, p_entity_keys: a.entityKeys, p_resource_ids: a.resourceIds, p_topic: a.topic, p_area: a.area, p_title_he: a.titleHe, p_body: a.body, p_source_type: "INFERRED", p_confidence: a.confidence, p_review_at: a.reviewAt, p_supersedes_id: a.supersedesId, p_supersede_reason: a.supersedeReason, p_links: a.links, p_authorization_id: a.authorizationId, p_request_key: a.requestKey }),
    transition: (a: { targetKind: string; targetId: string; toStatus: string; reasonHe: string | null; authorizationId: string; requestKey: string }) =>
      call(client, "sunny_brain_transition", { p_target_kind: a.targetKind, p_target_id: a.targetId, p_to_status: a.toStatus, p_reason_he: a.reasonHe, p_authorization_id: a.authorizationId, p_request_key: a.requestKey }),
    addLinks: (a: { links: Record<string, unknown>[]; authorizationId: string; requestKey: string }) =>
      call(client, "sunny_add_links", { p_links: a.links, p_authorization_id: a.authorizationId, p_request_key: a.requestKey }),
    /** A T2 request has NO effect: the Owner decides it in Redbloods (owner session). */
    requestApproval: (a: { kind: string; payload: Record<string, unknown>; summaryHe: string; riskHe: string; requestedClient: string | null; expiresAt: string | null; requestKey: string }) =>
      call(client, "owner_approval_request", { p_kind: a.kind, p_payload: a.payload, p_summary_he: a.summaryHe, p_risk_he: a.riskHe, p_requested_client: a.requestedClient, p_request_expires_at: a.expiresAt, p_request_key: a.requestKey }),
    cancelApproval: (a: { requestId: string; reasonHe: string | null }) => call(client, "owner_approval_cancel", { p_request_id: a.requestId, p_reason_he: a.reasonHe }),
  };
}

/** Owner-session writes: the client MUST carry the Owner's own JWT (createSupabaseServer). The DB proves the Owner; this code never claims it. */
export function createBrainOwnerStore(sessionClient: BrainRpcClient) {
  return {
    decide: (a: { requestId: string; decision: "APPROVED" | "REJECTED"; seenHash: string; approved: Record<string, unknown> | null; reasonHe: string | null }) =>
      call(sessionClient, "owner_approval_decide", { p_request_id: a.requestId, p_decision: a.decision, p_seen_hash: a.seenHash, p_approved: a.approved, p_reason_he: a.reasonHe }),
    revokeAuthorization: (a: { authorizationId: string; reasonHe: string }) =>
      call(sessionClient, "owner_revoke_tracking_authorization", { p_authorization_id: a.authorizationId, p_reason_he: a.reasonHe }),
    transition: (a: { targetKind: string; targetId: string; toStatus: string; reasonHe: string | null }) =>
      call(sessionClient, "owner_brain_transition", { p_target_kind: a.targetKind, p_target_id: a.targetId, p_to_status: a.toStatus, p_reason_he: a.reasonHe }),
  };
}

export const MAX_BRAIN_ROWS = 1000;
export type BrainRead = { status: "OK"; value: BrainSnapshot } | { status: "NOT_INSTALLED"; detail: string } | { status: "READ_FAILED"; detail: string };

/** Every Brain row (bounded, newest first) + the T2 queue when installed. A row breaking the contract fails the read. */
export async function readBrainSnapshot(client: BrainReadClient): Promise<BrainRead> {
  const q = (t: string, cols: string, order: string) => client.from(t).select(cols).order(order, { ascending: false }).limit(MAX_BRAIN_ROWS);
  const [res, auth, obs, rec, lnk, ev, rq, dc] = await Promise.all([
    q(BRAIN_TABLES.resources, BRAIN_COLUMNS.resources, "created_at"), q(BRAIN_TABLES.authorizations, BRAIN_COLUMNS.authorizations, "created_at"),
    q(BRAIN_TABLES.observations, BRAIN_COLUMNS.observations, "seq"), q(BRAIN_TABLES.records, BRAIN_COLUMNS.records, "seq"),
    q(BRAIN_TABLES.links, BRAIN_COLUMNS.links, "created_at"), q(BRAIN_TABLES.events, BRAIN_COLUMNS.events, "seq"),
    q(BRAIN_TABLES.requests, BRAIN_COLUMNS.requests, "seq"), q(BRAIN_TABLES.decisions, BRAIN_COLUMNS.decisions, "created_at"),
  ]);
  const brain = [res, auth, obs, rec, lnk, ev];
  const err = brain.find((r) => r.error)?.error;
  if (err) return notInstalled(err) ? { status: "NOT_INSTALLED", detail: err.message.slice(0, 200) } : { status: "READ_FAILED", detail: err.message.slice(0, 200) };
  const rows = (r: SelectResult) => (Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : []);
  const mapAll = <T,>(r: SelectResult, f: (x: Record<string, unknown>) => T | null) => { const raw = rows(r); const out = raw.map(f).filter((x): x is T => x !== null); return { out, bad: raw.length - out.length }; };
  const R = mapAll(res, mapResource), A = mapAll(auth, mapAuthorization), O = mapAll(obs, mapObservation), C = mapAll(rec, mapRecord), L = mapAll(lnk, mapLink), E = mapAll(ev, mapEvent);
  const bad = R.bad + A.bad + O.bad + C.bad + L.bad + E.bad;
  if (bad) return { status: "READ_FAILED", detail: `stored brain rows break the contract (${bad})` };
  let approvals: BrainSnapshot["approvals"] = null;
  if (!rq.error && !dc.error) {
    const Q = mapAll(rq, mapRequest), D = mapAll(dc, mapDecision);
    if (Q.bad + D.bad) return { status: "READ_FAILED", detail: `stored approval rows break the contract (${Q.bad + D.bad})` };
    approvals = { requests: Q.out, decisions: D.out };
  } else if (!notInstalled((rq.error ?? dc.error)!)) {
    return { status: "READ_FAILED", detail: (rq.error ?? dc.error)!.message.slice(0, 200) };
  }
  const truncated = [...brain, rq, dc].some((r) => rows(r).length >= MAX_BRAIN_ROWS);
  return { status: "OK", value: { resources: R.out, authorizations: A.out, observations: O.out, records: C.out, links: L.out, events: E.out, approvals, truncated } };
}
