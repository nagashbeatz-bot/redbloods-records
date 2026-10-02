/**
 * Sunny Brain v1 — the vocabularies of the applied schema (scripts/sql/sunny-brain/…sunny-brain-v1…, T2 approval queue).
 * Pure. Every list here mirrors a DB CHECK / function literal; scripts/test-sunny-brain.tsx pins them against the SQL text.
 * The DB is the authority: these lists only let Sunny / the dashboard refuse early with a clear message.
 *
 * RESERVED (never activated in v1): record types OUTCOME / EXPERIMENT, link roles TESTS / RESULT_OF / PRODUCED_LEARNING,
 * and any link ending at Owner memory (knowledge: / inbox: / context:). Citing Owner memory AS EVIDENCE (from) is allowed.
 */
export const BRAIN_PLATFORMS = ["instagram", "youtube", "tiktok", "spotify", "facebook", "x", "web"] as const;
export type BrainPlatform = (typeof BRAIN_PLATFORMS)[number];
export const RESOURCE_KINDS = ["ACCOUNT", "CONTENT", "PAGE"] as const;
export const CONTENT_KINDS = ["POST", "REEL", "STORY", "VIDEO", "SHORT", "LIVE", "PLAYLIST", "TRACK", "ALBUM", "ARTICLE"] as const;
export const PURPOSE_KINDS = ["OWN_PRESENCE", "REFERENCE_RESEARCH", "BUSINESS_SNAPSHOT"] as const;
/** Source kinds an authorization may allow (autonomous reads). */
export const AUTH_SOURCE_KINDS = ["PUBLIC_PROFILE_PAGE", "PUBLIC_CONTENT_PAGE", "WEB_PAGE", "REDBLOODS_RECORD", "PLATFORM_API"] as const;
/** Every observation source kind (Owner-given ones only through an approved OWNER_OBSERVATIONS request). */
export const OBS_SOURCE_KINDS = [...AUTH_SOURCE_KINDS, "OWNER_STATEMENT", "OWNER_SCREENSHOT", "PLATFORM_ANALYTICS_EXPORT"] as const;
export const OWNER_SOURCE_KINDS = ["OWNER_STATEMENT", "OWNER_SCREENSHOT", "PLATFORM_ANALYTICS_EXPORT"] as const;
export const CAPTURE_METHODS = ["CLAUDE_READ", "OWNER_PROVIDED", "SYSTEM_SNAPSHOT", "API"] as const;
export const CONFIDENCES = ["CONFIRMED", "HIGH", "MEDIUM", "LOW"] as const;
/** Intel record types written in v1. OUTCOME / EXPERIMENT exist in the CHECK but are RESERVED (the core refuses them). */
export const RECORD_TYPES = ["INSIGHT", "RECOMMENDATION"] as const;
export const RESERVED_RECORD_TYPES = ["OUTCOME", "EXPERIMENT"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export const INSIGHT_KINDS = ["EXPLANATION", "GAP", "PATTERN", "ANOMALY", "RISK", "OPPORTUNITY", "COMPARISON", "TREND"] as const;
export const CAUSAL_STATUSES = ["CORRELATION_ONLY", "PLAUSIBLE_CAUSE", "TESTED"] as const;
export const EFFORTS = ["LOW", "MEDIUM", "HIGH"] as const;
export const URGENCIES = ["NOW", "SOON", "LATER"] as const;
/** Intel areas (the P2 BusinessArea list + SALES / VENDORS, Brain only). */
export const INTEL_AREAS = ["PROJECTS", "SHOWS", "FINANCE", "RELEASES", "TEAM", "CLIENTS", "SOCIAL", "MARKETING", "CONTENT", "OPERATIONS", "SALES", "VENDORS"] as const;
export const LINK_ROLES = ["EVIDENCE_FOR", "EVIDENCE_AGAINST", "DERIVED_FROM", "COMPARES_TO", "RECOMMENDS", "IMPLEMENTED_BY"] as const;
export const RESERVED_LINK_ROLES = ["TESTS", "RESULT_OF", "PRODUCED_LEARNING"] as const;
export const TARGET_KINDS = ["RECORD", "OBSERVATION", "RESOURCE", "LINK"] as const;
export const T2_KINDS = ["TRACKING_AUTHORIZATION", "OWNER_OBSERVATIONS"] as const;
export type T2Kind = (typeof T2_KINDS)[number];

/** Lifecycle (sunny_intel_transition_ok). SUNNY moves go through the service wrapper; OWNER moves ONLY through T2 (Owner session). */
export const INTEL_TRANSITIONS: ReadonlyArray<readonly [RecordType, string | null, string, "SUNNY" | "OWNER"]> = [
  ["INSIGHT", null, "OPEN", "SUNNY"],
  ["INSIGHT", "OPEN", "WITHDRAWN", "SUNNY"], ["INSIGHT", "OPEN", "INVALIDATED", "SUNNY"], ["INSIGHT", "OPEN", "SUPERSEDED", "SUNNY"],
  ["INSIGHT", "OPEN", "ENDORSED", "OWNER"], ["INSIGHT", "OPEN", "REJECTED", "OWNER"], ["INSIGHT", "OPEN", "INVALIDATED", "OWNER"],
  ["INSIGHT", "ENDORSED", "REJECTED", "OWNER"], ["INSIGHT", "ENDORSED", "INVALIDATED", "OWNER"],
  ["RECOMMENDATION", null, "OPEN", "SUNNY"],
  ["RECOMMENDATION", "OPEN", "STALE", "SUNNY"], ["RECOMMENDATION", "OPEN", "ACTED_ON", "SUNNY"], ["RECOMMENDATION", "OPEN", "WITHDRAWN", "SUNNY"],
  ["RECOMMENDATION", "OPEN", "INVALIDATED", "SUNNY"], ["RECOMMENDATION", "OPEN", "SUPERSEDED", "SUNNY"], ["RECOMMENDATION", "ACCEPTED", "ACTED_ON", "SUNNY"],
  ["RECOMMENDATION", "OPEN", "ACCEPTED", "OWNER"], ["RECOMMENDATION", "OPEN", "REJECTED", "OWNER"],
  ["RECOMMENDATION", "ACCEPTED", "REJECTED", "OWNER"], ["RECOMMENDATION", "ACCEPTED", "STALE", "OWNER"],
];
export const transitionAllowed = (t: RecordType, from: string | null, to: string, actor: "SUNNY" | "OWNER") =>
  INTEL_TRANSITIONS.some(([a, b, c, d]) => a === t && b === from && c === to && d === actor);
/** A reason is required for these target statuses (DB CHECK sunny_events_reason_required). */
export const REASON_REQUIRED = ["REJECTED", "RETIRED", "INVALIDATED", "REVOKED", "WITHDRAWN", "ABANDONED", "STALE", "RETRACTED"] as const;

export const STATUS_HE: Record<string, string> = {
  OPEN: "פתוחה", ENDORSED: "אישרת", REJECTED: "נדחתה", WITHDRAWN: "סאני משכה", ACCEPTED: "קיבלת", ACTED_ON: "בוצעה", STALE: "לא רלוונטית",
  INVALIDATED: "בוטלה", SUPERSEDED: "הוחלפה", REVOKED: "בוטלה על ידך", RETIRED: "הוצאה משימוש", RETRACTED: "נמשך",
  ACTIVE: "פעילה", PENDING: "מחכה להחלטה שלך", APPROVED: "אושרה", CANCELLED: "בוטלה על ידי סאני", EXPIRED: "פג תוקף הבקשה",
};
export const PURPOSE_HE: Record<(typeof PURPOSE_KINDS)[number], string> = { OWN_PRESENCE: "הנוכחות שלנו", REFERENCE_RESEARCH: "מחקר השוואתי", BUSINESS_SNAPSHOT: "תמונת מצב עסקית" };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const OBS_TYPE_RE = /^[A-Z][A-Z0-9_]{1,30}\.[A-Z][A-Z0-9_]{1,40}$/;
export const FAMILY_RE = /^[A-Z][A-Z0-9_]{1,30}$/;
export const TOPIC_RE = /^[a-z][a-z0-9_]{1,30}(\.[a-z0-9_]{1,40}){0,4}$/;
export const IDENTITY_KEY_RE = /^(account|content|page):[A-Za-z0-9@._:/-]{1,160}$/;
export const SOURCE_REF_OPAQUE_RE = /^(redbloods|owner):[A-Za-z0-9:._-]{3,200}$/;
export const UNIT_RE = /^[A-Za-z_%₪$€]{1,16}$/;
