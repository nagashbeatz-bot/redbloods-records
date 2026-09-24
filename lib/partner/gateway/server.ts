import "server-only";

/**
 * Redbloods Partner — Gateway V1: internal server API. READ-ONLY.
 *
 *   getPartnerBrief()            — what matters now (≤5 items)
 *   resolvePartnerEntity(query)  — which entity a name means (ranked candidates, never a silent pick)
 *   getPartnerEntity(key)        — what Partner knows about one entity
 *
 * Transport-neutral: no route, no auth surface, no client-specific types in this mission. Every call opens
 * ONE request-scoped read context (read-context.ts) and hands plain data to the pure cores. There is no
 * decide / execute / answer / write capability anywhere in lib/partner/gateway.
 */
import { getPartnerBriefCore } from "./brief";
import { getPartnerEntityCore, parseEntityKey } from "./entity";
import { resolvePartnerEntityCore } from "./resolve";
import { APP_IDENTITIES, createGatewayReadContext, type GatewayReadContext } from "./read-context";
import type { GatewaySources } from "./core";
import type { BriefResponse, EntityResponse, ResolveResponse } from "./types";

export async function getPartnerBrief(ctx: GatewayReadContext = createGatewayReadContext()): Promise<BriefResponse> {
  const [finance, cases, actions, outcomes, memory] = await Promise.all([ctx.finance(), ctx.cases(), ctx.actions(), ctx.outcomes(), ctx.memory()]);
  const src: GatewaySources = { now: ctx.now, finance, cases, actions, outcomes, memory, identities: APP_IDENTITIES };
  return getPartnerBriefCore(src);
}

export async function resolvePartnerEntity(query: string, ctx: GatewayReadContext = createGatewayReadContext()): Promise<ResolveResponse> {
  const src: GatewaySources = { now: ctx.now, state: await ctx.state(), identities: APP_IDENTITIES };
  return resolvePartnerEntityCore(String(query ?? "").slice(0, 120), src);
}

export async function getPartnerEntity(key: string, ctx: GatewayReadContext = createGatewayReadContext()): Promise<EntityResponse> {
  const k = String(key ?? "").slice(0, 120);
  if (!parseEntityKey(k)) return getPartnerEntityCore(k, { now: ctx.now, identities: APP_IDENTITIES });
  const [state, finance, memory, cases, actions] = await Promise.all([ctx.state(), ctx.finance(), ctx.memory(), ctx.cases(), ctx.actions()]);
  return getPartnerEntityCore(k, { now: ctx.now, state, finance, memory, cases, actions, identities: APP_IDENTITIES });
}

export { createGatewayReadContext };
