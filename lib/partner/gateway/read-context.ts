import "server-only";

/**
 * Redbloods Partner — Gateway V1: request-scoped READ context.
 *
 * One Gateway call = one consistent read. Each canonical source is read at most ONCE per request and shared by
 * every consumer of that request:
 *   COO read + Partner Eyes read → ONE company state (the same assembly lib/partner/eyes/build.ts does);
 *   ONE finance live derivation → Finance view, Organizational Memory and the finance Action candidates;
 *   the SAME company state → Partner Cases and the deadline Action proposals.
 * Nothing is cached across requests, nothing is written. Each source fails closed on its own (UNAVAILABLE).
 *
 * Residual (reported, not hidden): the company state, the finance raw read and the Action-event / Outcome reads
 * are separate SELECTs issued milliseconds apart — a write landing between them could be seen by one and not the
 * other. There is no cross-source snapshot transaction in V1.
 */
import { buildCoo } from "../../coo/build";
import { assemblePartnerCompanyState } from "../eyes/company-state";
import { readPartnerEyesRaw } from "../eyes/readers";
import type { PartnerCompanyState } from "../eyes/types";
import { loadFinanceLive, type FinanceLiveResult } from "../finance/server";
import { buildFinanceBrief } from "../finance/brief";
import { loadPartnerMemory } from "../memory/server";
import { buildLiveCases } from "../actions/live";
import { getOwnerActionSurface } from "../actions/surface-server";
import { getRecentOutcomesSurface } from "../actions/outcome-server";
import { CLEANTONE_ARTIST_NAME, CLEANTONE_CLIENT_ID } from "../../red-artists/cleantone";
import type { Avail, GatewayFinance, GatewaySources } from "./core";

const fail = (e: unknown) => ({ status: "UNAVAILABLE" as const, detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) });

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

export interface GatewayReadContext {
  now: Date;
  state(): Promise<Avail<PartnerCompanyState>>;
  financeLive(): Promise<FinanceLiveResult>;
  finance(): Promise<Avail<GatewayFinance>>;
  memory(): Promise<GatewaySources["memory"]>;
  cases(): Promise<GatewaySources["cases"]>;
  actions(): Promise<GatewaySources["actions"]>;
  outcomes(): Promise<GatewaySources["outcomes"]>;
}

export function createGatewayReadContext(now: Date = new Date()): GatewayReadContext {
  const state = once(async (): Promise<Avail<PartnerCompanyState>> => {
    try {
      const [coo, raw] = await Promise.all([buildCoo(now), readPartnerEyesRaw()]);
      return { status: "OK", value: assemblePartnerCompanyState(coo, raw) };
    } catch (e) { return fail(e); }
  });
  const financeLive = once(() => loadFinanceLive(now));
  const finance = once(async (): Promise<Avail<GatewayFinance>> => {
    const l = await financeLive();
    if (l.status !== "OK") return { status: "UNAVAILABLE", detail: l.detail };
    const brief = l.answersAvailable ? buildFinanceBrief(l.state, l.integrity, { answersAvailable: true, actionNoteHe: l.actionNoteHe }) : null;
    return { status: "OK", value: { state: l.state, integrity: l.integrity, actions: l.actions, raw: l.raw, brief, answersAvailable: l.answersAvailable } };
  });
  const memory = once(async (): Promise<GatewaySources["memory"]> => {
    try { return { status: "OK", value: await loadPartnerMemory(now, { finance: await financeLive() }) }; } catch (e) { return fail(e); }
  });
  const cases = once(async (): Promise<GatewaySources["cases"]> => {
    const s = await state();
    if (s.status !== "OK") return { status: "UNAVAILABLE", detail: s.detail };
    try { return { status: "OK", value: (await buildLiveCases(s.value)).cases }; } catch (e) { return fail(e); }
  });
  const actions = once(async (): Promise<GatewaySources["actions"]> => {
    const s = await state();
    try {
      const r = await getOwnerActionSurface({ state: s.status === "OK" ? s.value : undefined, finance: financeLive });
      return r.status === "OK" ? { status: "OK", value: r.response.items } : { status: "UNAVAILABLE", detail: "action surface unavailable" };
    } catch (e) { return fail(e); }
  });
  const outcomes = once(async (): Promise<GatewaySources["outcomes"]> => {
    try {
      const r = await getRecentOutcomesSurface();
      return r.status === "OK" ? { status: "OK", value: r.response.items } : { status: "UNAVAILABLE", detail: "recent outcomes unavailable" };
    } catch (e) { return fail(e); }
  });
  return { now, state, financeLive, finance, memory, cases, actions, outcomes };
}

/** Code-level canonical identities, taken from the modules that own them (never re-declared). */
export const APP_IDENTITIES: GatewaySources["identities"] = {
  cleantone: { clientId: CLEANTONE_CLIENT_ID, labelArtistName: CLEANTONE_ARTIST_NAME },
};
