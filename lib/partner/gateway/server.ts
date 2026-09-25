import "server-only";

/**
 * Redbloods Partner — the Unified Partner Knowledge Gateway: internal server API. READ-ONLY.
 *
 *   getPartnerBrief()             — ORIENT: what matters now (≤5 items)
 *   resolvePartnerEntity(query)   — which entity a name means (ranked candidates, never a silent pick)
 *   getPartnerEntity(key)         — INSPECT: what Partner knows about one entity (+ automatic knowledge enrichment)
 *   queryPartnerKnowledge(req)    — DISCOVER / QUERY: any registered knowledge capability (lib/partner/knowledge)
 *
 * Transport-neutral: every interface (Redbloods OS routes, the Claude MCP adapter, future ones) calls these same
 * functions with its KnowledgeAudience. Every call opens ONE request-scoped CompanyReadContext (each source read at
 * most once) and hands plain data to the pure cores. There is no decide / execute / answer / write capability
 * anywhere in lib/partner/gateway or lib/partner/knowledge.
 */
import { getPartnerBriefCore } from "./brief";
import { getPartnerEntityCore, parseEntityKey } from "./entity";
import { resolvePartnerEntityCore } from "./resolve";
import { APP_IDENTITIES, createGatewayReadContext, type GatewayReadContext } from "./read-context";
import type { Avail, GatewaySources } from "./core";
import type { BriefResponse, EntityResponse, ResolveResponse } from "./types";
import { createCompanyReadContext, type CompanyReadContext } from "../company/read-context";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../knowledge/catalog";
import { entityKnowledge, queryKnowledgeCore, RESTRICTIVE_AUDIENCE, validateKnowledgeRequest } from "../knowledge/query";
import type { KnowledgeRegistry } from "../knowledge/registry";
import type { KnowledgeAudience, KnowledgeRequest, KnowledgeSourceNeed, QueryResponse } from "../knowledge/types";

type AnyCtx = GatewayReadContext | CompanyReadContext;

async function integrityOf(ctx: AnyCtx): Promise<Avail<CompanyIntegrityRegister> | undefined> {
  if (!("integrity" in ctx)) return undefined;
  try {
    const r = await ctx.integrity();
    return r.sources.find((s) => s.source.startsWith("company-state"))?.status === "OK" ? { status: "OK", value: r } : { status: "UNAVAILABLE", detail: "company state unavailable" };
  } catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
}

/** Loads exactly the declared sources (each memoized by the read context → read at most once per request). */
async function loadSources(ctx: AnyCtx, needs: readonly KnowledgeSourceNeed[], audience: KnowledgeAudience): Promise<GatewaySources> {
  const want = new Set(needs);
  const [state, finance, memory, cases, actions, outcomes, integrity, ownerKnowledge, operations, projectDetail, settings] = await Promise.all([
    want.has("STATE") ? ctx.state() : undefined, want.has("FINANCE") ? ctx.finance() : undefined, want.has("MEMORY") ? ctx.memory() : undefined,
    want.has("CASES") ? ctx.cases() : undefined, want.has("ACTIONS") ? ctx.actions() : undefined, want.has("OUTCOMES") ? ctx.outcomes() : undefined,
    want.has("INTEGRITY") ? integrityOf(ctx) : undefined,
    want.has("OWNER_KNOWLEDGE") && "ownerKnowledge" in ctx ? ctx.ownerKnowledge() : undefined,
    want.has("OPERATIONS") && "operations" in ctx ? ctx.operations() : undefined,
    want.has("PROJECT_DETAIL") && "projectDetail" in ctx ? ctx.projectDetail() : undefined,
    want.has("SETTINGS") && "settings" in ctx ? ctx.settings() : undefined,
  ]);
  return { now: ctx.now, state, finance, memory, cases, actions, outcomes, integrity, ownerKnowledge, operations, projectDetail, settings, identities: APP_IDENTITIES, audience };
}

export async function getPartnerBrief(ctx: AnyCtx = createCompanyReadContext(), audience: KnowledgeAudience = RESTRICTIVE_AUDIENCE): Promise<BriefResponse> {
  return getPartnerBriefCore(await loadSources(ctx, ["FINANCE", "CASES", "ACTIONS", "OUTCOMES", "MEMORY", "INTEGRITY"], audience));
}

export async function resolvePartnerEntity(query: string, ctx: AnyCtx = createCompanyReadContext()): Promise<ResolveResponse> {
  const src: GatewaySources = { now: ctx.now, state: await ctx.state(), identities: APP_IDENTITIES };
  return resolvePartnerEntityCore(String(query ?? "").slice(0, 120), src);
}

export async function getPartnerEntity(key: string, ctx: AnyCtx = createCompanyReadContext(), audience: KnowledgeAudience = RESTRICTIVE_AUDIENCE, registry: KnowledgeRegistry = PARTNER_KNOWLEDGE_REGISTRY): Promise<EntityResponse> {
  const k = String(key ?? "").slice(0, 120);
  if (!parseEntityKey(k)) return getPartnerEntityCore(k, { now: ctx.now, identities: APP_IDENTITIES });
  // project entities also load the project's human context + material metadata (Owner-only capability, bounded)
  const needs: KnowledgeSourceNeed[] = ["STATE", "FINANCE", "MEMORY", "CASES", "ACTIONS", "INTEGRITY", "OWNER_KNOWLEDGE", "OPERATIONS", ...(k.startsWith("project:") ? ["PROJECT_DETAIL" as const] : [])];
  const src = await loadSources(ctx, needs, audience);
  return getPartnerEntityCore(k, { ...src, entityKnowledge: (entityKey) => entityKnowledge(registry, src, entityKey) });
}

/** DISCOVER / QUERY any registered capability. Refusals (unknown / not authorized / invalid) read nothing. */
export async function queryPartnerKnowledge(req: KnowledgeRequest, audience: KnowledgeAudience, ctx: AnyCtx = createCompanyReadContext(), registry: KnowledgeRegistry = PARTNER_KNOWLEDGE_REGISTRY): Promise<QueryResponse> {
  const v = validateKnowledgeRequest(registry, req, audience);
  const src = v.ok ? await loadSources(ctx, v.value.cap.needs, audience) : { now: ctx.now, identities: APP_IDENTITIES, audience };
  return queryKnowledgeCore(registry, req, src, audience);
}

/** The capability index an interface may advertise (e.g. the MCP tool description) — derived from the registry. */
export function describePartnerKnowledge(audience: KnowledgeAudience, registry: KnowledgeRegistry = PARTNER_KNOWLEDGE_REGISTRY) {
  return registry.describe(audience).map((c) => ({ id: c.id, title: c.title, description: c.description, modes: Object.keys(c.modes), params: Object.keys(c.params) }));
}

export { createGatewayReadContext, createCompanyReadContext };
