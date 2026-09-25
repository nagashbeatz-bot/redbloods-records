/**
 * Sunny System Awareness — the contract types. Pure, no imports of runtime code.
 *
 * THREE knowledge layers (never mixed):
 *   1 CANONICAL COMPANY STATE      — projects, transactions, shows… read LIVE through the Partner readers / Gateway.
 *   2 REDBLOODS SYSTEM KNOWLEDGE   — how the company operating system works: domains, meaning, canonical sources,
 *                                    relationships + their quality, business rules, side effects, what Sunny can
 *                                    read / learn / propose / execute, limitations. ← THIS module (lib/partner/system).
 *   3 OWNER ORGANIZATIONAL KNOWLEDGE — nicknames, reasons, priorities, expectations (lib/partner/owner-knowledge, P2).
 *
 * The contracts are SEMANTIC: no table / column / env / secret / source-code detail is ever served to a remote
 * interface. `surfaces` (UI routes / API groups) exist only for the repository-wide awareness test and are stripped
 * from every served descriptor.
 */

/** How complete Sunny's support is on one dimension. FULL requires useful live semantic state, not mere awareness. */
/** NOT_YET_EXECUTABLE: a legitimate capability Sunny will get through a typed, Owner-approved primitive — never "forbidden forever".
 *  INTENTIONALLY_UNAVAILABLE: reserved for secrets / credentials (and similar security material). */
export type SunnySupport = "FULL" | "PARTIAL" | "MISSING" | "NOT_YET_EXECUTABLE" | "INTENTIONALLY_UNAVAILABLE";

/** Operational state labels (a domain may carry several). */
export type CapabilityState =
  | "AVAILABLE" | "PARTIAL" | "NOT_CONNECTED" | "READ_ONLY" | "LEARN_AVAILABLE" | "PROPOSAL_ONLY"
  | "ACTION_AVAILABLE" | "OWNER_APPROVAL_REQUIRED" | "INTENTIONALLY_UNAVAILABLE";

export type RelationQuality = "CANONICAL_RELATION" | "OWNER_CONFIRMED_RELATION" | "DERIVED_RELATION" | "TEXT_MATCH" | "AMBIGUOUS" | "UNKNOWN";

export type RuleClass = "CANONICAL_BUSINESS_RULE" | "IMPLEMENTATION_BEHAVIOR" | "OWNER_POLICY" | "LEGACY_BEHAVIOR" | "POSSIBLE_BUG" | "CONFLICT";

/**
 * No legitimate Redbloods operation is permanently forbidden to Sunny (Owner directive, 2026-09-25): risk decides the
 * CONFIRMATION a future typed primitive needs, never whether it may exist. SECURITY_RESTRICTED is only for auth /
 * roles / credentials / integration secrets.
 */
export type ActionClass = "READ_ONLY" | "LEARN_ONLY" | "PROPOSAL_CANDIDATE" | "VALIDATED_ACTION_EXISTS" | "FUTURE_PRIMITIVE_REQUIRED" | "SECURITY_RESTRICTED";

/** The confirmation a mutation needs (an action can need several; OWNER_APPROVAL_REQUIRED is always included). */
export type ConfirmationClass =
  | "OWNER_APPROVAL_REQUIRED" | "STRONG_CONFIRMATION_REQUIRED" | "DESTRUCTIVE_CONFIRMATION_REQUIRED"
  | "FINANCIAL_CONFIRMATION_REQUIRED" | "EXTERNAL_EFFECT_CONFIRMATION_REQUIRED" | "SECURITY_RESTRICTED";

export type TriggerType = "MANUAL" | "EVENT" | "SCHEDULED" | "AGENT_CHECK";

/** Where approval happens today. NOT_EXECUTABLE_YET = no typed primitive exists yet (NOT a permanent prohibition). */
export type Approval = "NONE" | "OWNER_CONFIRMATION_IN_CONVERSATION" | "OWNER_APPROVAL_IN_DASHBOARD" | "NOT_EXECUTABLE_YET";

export type DomainGroup = "WORK" | "LABEL" | "MONEY" | "VENDORS" | "MEDIA_FILES" | "OPERATIONS" | "NOTIFICATIONS" | "SUNNY";

export interface BusinessRule {
  /** Stable id: ^[A-Z][A-Z0-9_]{2,50}$ */
  id: string;
  class: RuleClass;
  /** The semantic rule (English, for reasoning). Never an implementation detail. */
  text: string;
  /** Other domains this rule touches. */
  touches?: readonly string[];
}

export interface SideEffect {
  id: string;
  /** What business event causes it. */
  when: string;
  /** What happens in other domains. */
  effect: string;
  targets: readonly string[];
  trigger: TriggerType;
  quality: "CANONICAL_BUSINESS_RULE" | "IMPLEMENTATION_BEHAVIOR";
}

export interface NotificationContract {
  id: string;
  /** Business event the notification represents. */
  event: string;
  recipients: string;
  trigger: TriggerType;
  guard: string;
  /** Sunny may NEVER trigger notifications; stated per contract so the model cannot assume otherwise. */
  sunnyMayTrigger: false;
}

export interface DomainContract {
  /** ^[A-Z][A-Z0-9_]{2,40}$ — stable. */
  id: string;
  group: DomainGroup;
  titleHe: string;
  /** Business purpose (English, for reasoning). */
  purpose: string;
  /** Where the truth lives, semantically (never table / column names). */
  canonicalSource: string;
  entityTypes: readonly string[];
  support: { read: SunnySupport; learn: SunnySupport; propose: SunnySupport; execute: SunnySupport };
  states: readonly CapabilityState[];
  /** partner_query capability ids that serve this domain's live state (validated against the knowledge registry). */
  readCapabilities: readonly string[];
  /** P2 knowledge kinds the Owner can teach about it (validated against the kind registry). */
  learnKinds: readonly string[];
  /** Existing validated Partner action ids Sunny can PROPOSE for it. */
  proposableActions: readonly string[];
  approval: Approval;
  freshness: "LIVE" | "PARTIAL" | "NOT_CONNECTED" | "NOT_APPLICABLE";
  rules: readonly BusinessRule[];
  sideEffects: readonly SideEffect[];
  notifications?: readonly NotificationContract[];
  /** Hebrew, for the Owner: what Sunny cannot see / do here, stated honestly. */
  limitationsHe: readonly string[];
  /** INTERNAL (awareness test only, never served): UI routes + API groups this domain owns. */
  surfaces: { pages: readonly string[]; api: readonly string[] };
}

export interface Relationship {
  from: string;
  to: string;
  /** What connects them, semantically. */
  via: string;
  quality: RelationQuality;
  note?: string;
}

export interface BusinessActionContract {
  /** ^[A-Z][A-Z0-9_]{2,50}$ */
  id: string;
  domain: string;
  meaning: string;
  class: ActionClass;
  financialRisk: "NONE" | "LOW" | "HIGH";
  externalRisk: "NONE" | "DROPBOX" | "GOOGLE_CALENDAR" | "PUSH" | "EMAIL" | "MULTIPLE";
  approval: Approval;
  /** The confirmation classes a Sunny primitive for this action must enforce (derived from risk + explicit extras). */
  confirmations: readonly ConfirmationClass[];
  /** Whether Sunny itself can execute it today. Always false in this baseline (approval / execution happen in the dashboard). */
  sunnyCanExecuteToday: false;
  /** The Partner action type id when VALIDATED_ACTION_EXISTS. */
  primitive?: string;
  /** Why it is not YET available to Sunny / what a primitive must handle. */
  reason: string;
  /**
   * FUTURE primitives: the typed inputs a narrow primitive would need (so Sunny can collect them from the Owner and
   * ask ONLY for what is genuinely missing) and the side effects its preview must show before approval.
   */
  design?: { inputs: readonly string[]; optionalInputs: readonly string[]; previewEffects: readonly string[] };
}

/** Capability change awareness: one entry per support change (never rewritten; newest last). */
export interface CapabilityChange {
  version: string;
  date: string;
  domain: string;
  dimension: "read" | "learn" | "propose" | "execute" | "domain";
  from: string;
  to: string;
  noteHe: string;
}

/** An app surface that is intentionally NOT a business domain for Sunny (with the explicit SUNNY IMPACT decision). */
export interface SurfaceExclusion { surface: string; kind: "page" | "api"; impact: "NONE"; reason: string }
