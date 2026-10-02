/**
 * Sunny Brain — the ONE observe tool (partner_observe). Pure: definition + strict top-level shape check.
 *
 * Listed ONLY when the deployment's observe switch is on AND the token holds partner:observe. The scope alone grants no
 * tracking: every write op names a tracking authorization the Owner approved in Redbloods, and the DB re-checks it on
 * every write. Asking the Owner (request_*) has no effect until he decides in Redbloods. There is no generic write: each
 * op has fixed typed fields (deep validation in lib/partner/brain/requests.ts, then the DB). Reads are partner_query
 * capability `brain`. No SQL / table / RPC / URL-to-fetch / path / token / header argument exists.
 */
export const OBSERVE_TOOL = "partner_observe";
export const OBSERVE_OPS = ["request_authorization", "request_owner_observations", "cancel_request", "register_content", "record_observations", "create_record", "transition", "add_links"] as const;
export type ObserveOp = (typeof OBSERVE_OPS)[number];

/** The exact keys each op accepts (besides "op"). */
export const OBSERVE_FIELDS: Record<ObserveOp, readonly string[]> = {
  request_authorization: ["authorization", "expiresInDays", "requestKey"],
  request_owner_observations: ["items", "requestKey"],
  cancel_request: ["requestId", "reasonHe"],
  register_content: ["authorizationId", "content", "requestKey"],
  record_observations: ["authorizationId", "items", "batchId", "requestKey"],
  create_record: ["authorizationId", "record", "requestKey"],
  transition: ["authorizationId", "transition", "requestKey"],
  add_links: ["authorizationId", "links", "requestKey"],
};
const REQUIRED: Record<ObserveOp, readonly string[]> = {
  request_authorization: ["authorization"], request_owner_observations: ["items"], cancel_request: ["requestId"],
  register_content: ["authorizationId", "content"], record_observations: ["authorizationId", "items"], create_record: ["authorizationId", "record"],
  transition: ["authorizationId", "transition"], add_links: ["authorizationId", "links"],
};
/** Ops that write under an authorization (the DB checks it) vs ops that only ASK the Owner (no effect). */
export const OBSERVE_WRITE_OPS: readonly ObserveOp[] = ["register_content", "record_observations", "create_record", "transition", "add_links"];
const FORBIDDEN_KEY = /^(sql|query|table|rpc|function|path|url|endpoint|route|token|secret|headers?|body|actor|approval(basis|ref)?|basis|owner(id)?|uid|role)$/i;

export function validateObserveInput(raw: unknown): { ok: true; op: ObserveOp; input: Record<string, unknown> } | { ok: false; code: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "INVALID_ARGS" };
  const o = raw as Record<string, unknown>;
  const op = o.op;
  if (typeof op !== "string" || !(OBSERVE_OPS as readonly string[]).includes(op)) return { ok: false, code: "UNKNOWN_OP" };
  const allowed = OBSERVE_FIELDS[op as ObserveOp];
  const keys = Object.keys(o).filter((k) => k !== "op");
  if (keys.some((k) => FORBIDDEN_KEY.test(k))) return { ok: false, code: "FORBIDDEN_FIELD" };
  if (keys.some((k) => !allowed.includes(k))) return { ok: false, code: "UNKNOWN_FIELD" };
  if (REQUIRED[op as ObserveOp].some((k) => o[k] === undefined)) return { ok: false, code: "MISSING_FIELD" };
  return { ok: true, op: op as ObserveOp, input: Object.fromEntries(keys.map((k) => [k, o[k]])) };
}

export const OBSERVE_TOOL_DEFINITION = {
  name: OBSERVE_TOOL,
  title: "Redbloods Sunny — Brain: track, observe, infer (under the Owner's authorization)",
  description:
    "Sunny's Brain. Read it first with partner_query capability \"brain\" (authorizations, pending approvals, resources, observations, insights / recommendations). " +
    "WITHOUT an ACTIVE tracking authorization you may only ASK: op request_authorization {authorization: {purposeKind: OWN_PRESENCE|REFERENCE_RESEARCH|BUSINESS_SNAPSHOT, purposeHe, resourceIds?, newResources?: [{platform: instagram|youtube|tiktok|spotify|facebook|x|web, resourceKind: ACCOUNT|PAGE, identityKey: 'account:handle:<handle>' | 'account:id:<id>' (web: canonicalUrl only), firstHandle?, canonicalUrl?, displayName?}], includeChildResources: bool, entityKeys?, observationFamilies: ['INSTAGRAM', …], sourceKinds: [PUBLIC_PROFILE_PAGE|PUBLIC_CONTENT_PAGE|WEB_PAGE|REDBLOODS_RECORD|PLATFORM_API], insightsAllowed: bool, recommendationsAllowed: bool, maxObservationsPerDay?: int|null, validFrom: YYYY-MM-DD (today or later), validUntil?: YYYY-MM-DD|null, baseAuthorizationId?}} — every boolean explicit, never assumed. " +
    "The Owner decides it ONLY in Redbloods (the approvals screen /sunny-approvals — אישורים לסאני); tell him it is waiting there. Never say it is approved until partner_query brain shows the authorization ACTIVE. " +
    "Values the Owner told you (numbers from his screen, his analytics export): op request_owner_observations {items} with sourceType OWNER_STATEMENT, sourceKind OWNER_STATEMENT|OWNER_SCREENSHOT|PLATFORM_ANALYTICS_EXPORT, captureMethod OWNER_PROVIDED — recorded only after he approves in Redbloods. op cancel_request {requestId, reasonHe?} withdraws your own pending request. " +
    "UNDER an active authorization (authorizationId; the database refuses anything outside its scope, families, source kinds, window or daily cap): " +
    "record_observations {items: 1–40 × {resourceId | entityKey, type: FAMILY.METRIC, valueNum | valueText | valueBool, unit?, observedAt (ISO), periodStart?, periodEnd?, sourceType: EXTERNAL_SOURCE (sourceKind PUBLIC_*/WEB_PAGE/PLATFORM_API, captureMethod CLAUDE_READ|API, confidence HIGH|MEDIUM|LOW — never CONFIRMED) | SYSTEM_RECORD (REDBLOODS_RECORD + SYSTEM_SNAPSHOT), sourceRef?: the public https page you read, correctsId?}} — an observation is ONE value you actually read, never an inference, never invented, never scraped behind a login; " +
    "register_content {content: {platform, contentKind: POST|REEL|STORY|VIDEO|SHORT|LIVE|PLAYLIST|TRACK|ALBUM|ARTICLE, parentId: the covered account, identityKey: 'content:<platform id>', canonicalUrl?, displayName?}}; " +
    "create_record {record: {recordType: INSIGHT|RECOMMENDATION, entityKeys?, resourceIds?, topic?, area, titleHe, body (INSIGHT: statementHe, insightKind: EXPLANATION|GAP|PATTERN|ANOMALY|RISK|OPPORTUNITY|COMPARISON|TREND, causalStatus: CORRELATION_ONLY|PLAUSIBLE_CAUSE|TESTED, reasoningHe?, counterEvidenceHe?, periodFrom?, periodTo?; RECOMMENDATION: recommendationHe, presentedHe = the exact words you showed the Owner, whyHe?, expectedEffectHe?, effort?, urgency?), confidence: HIGH|MEDIUM|LOW, reviewAt?, supersedesId?, supersedeReason?, links: [{role: EVIDENCE_FOR|EVIDENCE_AGAINST|DERIVED_FROM|COMPARES_TO|RECOMMENDS|IMPLEMENTED_BY, fromRecord|fromObs|fromRef, toRecord|toResource|toRef, noteHe?}] — use \"$self\" for the new record; an INSIGHT needs ≥ 1 EVIDENCE_FOR, a RECOMMENDATION needs RECOMMENDS / EVIDENCE_FOR}} — an insight is YOUR hypothesis, never a fact; correlation is not cause; a recommendation executes nothing; " +
    "transition {transition: {targetKind: RECORD|OBSERVATION|RESOURCE|LINK, targetId, toStatus, reasonHe?}} — your own moves only (WITHDRAWN / INVALIDATED / STALE / ACTED_ON (needs an IMPLEMENTED_BY plan link) / RETIRED / RETRACTED); ENDORSED / REJECTED / ACCEPTED are the Owner's, in Redbloods; add_links {links}. " +
    "Never turn an insight into an Owner learning or decision yourself — that is partner_propose_knowledge (BUSINESS_LEARNING / BUSINESS_DECISION) with his approval. No link may end at Owner memory. reviewAt is context only (no automatic review). Every write takes an optional requestKey (uuid) — reuse it on a retry. NOT_INSTALLED = the Brain is not in the database yet: nothing was recorded.",
  inputSchema: {
    type: "object",
    properties: {
      op: { type: "string", enum: [...OBSERVE_OPS] },
      authorizationId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
      requestKey: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
      requestId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
      batchId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
      expiresInDays: { type: "integer", minimum: 1, maximum: 60 },
      reasonHe: { type: "string", minLength: 1, maxLength: 300 },
      authorization: { type: "object" }, content: { type: "object" }, record: { type: "object" }, transition: { type: "object" },
      items: { type: "array", minItems: 1, maxItems: 40, items: { type: "object" } },
      links: { type: "array", minItems: 1, maxItems: 40, items: { type: "object" } },
    },
    required: ["op"],
    additionalProperties: false,
  },
  annotations: { title: "Redbloods Sunny — Brain", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
} as const;
