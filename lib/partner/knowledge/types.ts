/**
 * Redbloods Partner — Unified Knowledge: the capability contract. Pure types.
 *
 * THE RULE (permanent, Owner decision 2026-09-24): Partner READ knowledge is registered ONCE, here, and every Partner
 * interface (Redbloods OS UI, the Claude MCP connector, any future interface) reaches it through the ONE Partner
 * Gateway. A new Partner read capability needs exactly:
 *   1. a canonical reader (Eyes / Finance Brain / Memory / Integrity / … — never a new DB path from here);
 *   2. semantic interpretation (the domain module that owns the meaning);
 *   3. epistemic classification (FACT / DERIVED / OWNER_DECISION / OBSERVATION / HYPOTHESIS / PATTERN_CANDIDATE / UNKNOWN);
 *   4. registration (a KnowledgeCapability in lib/partner/knowledge/catalog.ts);
 *   5. limits / freshness / access / sensitivity metadata (below);
 *   6. tests.
 * NOT a new Claude integration: the MCP adapter never knows what a capability means.
 *
 * The registry IS the allowlist: only registered capabilities can be queried, only with their declared modes and
 * typed, bounded parameters. No SQL, no table / column / module / function names, no arbitrary filters — ever.
 * This applies to READ knowledge only: nothing here writes, decides, approves or executes, and registering a
 * capability can never expose a write.
 */
import type { GText, GatewayEntityType, GatewayEpistemic, GatewayFreshness, GatewayMissing, GatewayRelationQuality, GatewaySourceName, GatewayDrillDown } from "../gateway/types";
import type { GatewaySources } from "../gateway/core";

export const KNOWLEDGE_SCHEMA_VERSION = "partner-knowledge-v1";

export type KnowledgeDomain = "COMPANY" | "PARTNER" | "FINANCE" | "PROJECTS" | "CLIENTS" | "SALES" | "LABEL" | "SHOWS" | "SESSIONS" | "TEAM";

/** Which request-scoped Partner sources a capability reads (the Gateway loads only these, once per request). */
export type KnowledgeSourceNeed = "STATE" | "FINANCE" | "MEMORY" | "CASES" | "ACTIONS" | "OUTCOMES" | "INTEGRITY";

/**
 * Who is asking. INTERNAL = a Redbloods OS surface behind the Owner session. EXTERNAL = a remote interface (the Claude
 * MCP connector). ownerAuthorized = the request carries the Owner's authority (an Owner session, or a connector token
 * that only the Owner could grant). Readers never see the audience — access is decided before any read.
 */
export interface KnowledgeAudience { channel: "INTERNAL" | "EXTERNAL"; ownerAuthorized: boolean }

/** Typed, bounded parameters — the ONLY input a capability accepts. */
export type KnowledgeParamSpec =
  | { kind: "enum"; values: readonly string[]; descriptionForModel: string }
  | { kind: "text"; maxLength: number; descriptionForModel: string }
  | { kind: "entityKey"; types: readonly GatewayEntityType[]; descriptionForModel: string }
  | { kind: "ymd"; descriptionForModel: string };

export type KnowledgeParamValue = string;

export interface KnowledgeQuery { mode: string; params: Readonly<Record<string, KnowledgeParamValue>> }

/** One piece of Partner knowledge. Values are numbers, codes, YYYY-MM-DD, booleans, or GText for record text. */
export interface KnowledgeItem {
  /** Stable within the capability (used for deterministic paging). */
  id: string;
  /** Gateway entity key to drill into with partner_entity, when the item is an entity. */
  entity: string | null;
  label: GText;
  epistemic: GatewayEpistemic;
  freshness: GatewayFreshness;
  source: GatewaySourceName;
  /** How the item is linked to what was asked about (TEXT_MATCH is never a hard link). */
  relationQuality?: GatewayRelationQuality;
  fields: Record<string, unknown>;
}

/** A bounded aggregate statement (counts, per-currency amounts — never merged across currencies). */
export interface KnowledgeFact { code: string; label: GText; value: unknown; epistemic: GatewayEpistemic; freshness: GatewayFreshness; source: GatewaySourceName }

/**
 *   COMPLETE — every canonical row of this kind was read.
 *   PARTIAL  — known coverage gap (e.g. future schedule without Google Calendar); coverage[] says what is missing.
 *   UNKNOWN  — a needed source could not be read; nothing here means "none".
 */
export type KnowledgeCompleteness = "COMPLETE" | "PARTIAL" | "UNKNOWN";

export interface KnowledgeReadResult {
  items: KnowledgeItem[];
  summary: KnowledgeFact[];
  completeness: KnowledgeCompleteness;
  coverage: GText[];
  missing: GatewayMissing[];
}

/** Everything a capability may read: the SAME request-scoped sources every Gateway call uses. */
export type KnowledgeSources = GatewaySources;

export interface KnowledgeCapability {
  /** ^[a-z][a-z0-9_]{2,33}$ — stable, never a table / module / function name. */
  id: string;
  domain: KnowledgeDomain;
  /** Short Hebrew title (UI). */
  titleHe: string;
  /** For LLM tool selection: what it answers, and what it does NOT know. English. */
  descriptionForModel: string;
  /** How the Owner might ask (Hebrew). */
  examplesHe: readonly string[];
  modes: Readonly<Record<string, { descriptionForModel: string }>>;
  defaultMode: string;
  params: Readonly<Record<string, KnowledgeParamSpec>>;
  /**
   * When set, partner_entity for these entity types automatically includes this capability's result, with the
   * entity key passed as `param` (automatic enrichment — no per-capability Gateway code).
   */
  entityScope?: { types: readonly GatewayEntityType[]; param: string; mode: string; limit: number };
  paging: { defaultLimit: number; maxLimit: number };
  access: {
    /** false = INTERNAL only (never served to a remote interface; refused as unknown there). */
    externalRead: boolean;
    /** true = only with the Owner's authority. */
    ownerOnly: boolean;
    sensitivity: "STANDARD" | "FINANCIAL" | "PERSONAL";
  };
  needs: readonly KnowledgeSourceNeed[];
  /** PURE: reads the given sources only; returns every matching item in a deterministic order (the Gateway pages). */
  read(src: KnowledgeSources, q: KnowledgeQuery): KnowledgeReadResult;
}

export type QueryStatus = "OK" | "UNKNOWN_CAPABILITY" | "NOT_AUTHORIZED" | "INVALID_REQUEST" | "INVALID_CURSOR";

export interface KnowledgeRequest { capability: string; mode?: string; params?: Record<string, unknown>; limit?: number; cursor?: string }

export interface CapabilityDescriptor {
  id: string;
  domain: KnowledgeDomain;
  title: string;
  description: string;
  examples: string[];
  modes: Record<string, string>;
  defaultMode: string;
  params: Record<string, { kind: KnowledgeParamSpec["kind"]; values?: string[]; maxLength?: number; entityTypes?: string[]; description: string }>;
  paging: { defaultLimit: number; maxLimit: number };
  ownerOnly: boolean;
  sensitivity: KnowledgeCapability["access"]["sensitivity"];
  entityScope: string[];
}

export interface QueryResponse {
  schemaVersion: string;
  knowledgeSchemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
  tool: "partner_query";
  query: Record<string, string>;
  asOf: string;
  freshness: GatewayFreshness;
  sources: Array<{ source: string; status: "OK" | "UNAVAILABLE"; freshness: GatewayFreshness }>;
  textPolicy: string;
  status: QueryStatus;
  capability: { id: string; domain: KnowledgeDomain; title: string } | null;
  mode: string | null;
  params: Record<string, string>;
  completeness: KnowledgeCompleteness | null;
  coverage: GText[];
  summary: KnowledgeFact[];
  items: KnowledgeItem[];
  page: { limit: number; offset: number; returned: number; total: number; nextCursor: string | null } | null;
  missing: GatewayMissing[];
  drillDown: GatewayDrillDown[];
  error: { code: QueryStatus; message: string } | null;
}

/** partner_entity's automatic enrichment: one section per entity-scoped capability. */
export interface EntityKnowledgeSection {
  capability: string;
  title: string;
  completeness: KnowledgeCompleteness;
  summary: KnowledgeFact[];
  items: KnowledgeItem[];
  total: number;
  coverage: GText[];
}
