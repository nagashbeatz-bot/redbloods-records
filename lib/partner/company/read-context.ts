import "server-only";

/**
 * Redbloods Partner — CompanyReadContext (foundation). Request-scoped, bounded, read-only.
 *
 * One company read = each canonical source read at most ONCE and shared by every consumer of the request. It
 * EXTENDS the Gateway read context (company state, the Finance Brain live derivation, Organizational Memory,
 * Cases, Actions, Outcomes — all memoized there) with:
 *   ownerContexts() — the Owner's ACTIVE answers (CURRENT_APPLICABLE), fail-closed (null = unreadable);
 *   extras()        — narrow SELECTs the Eyes do not cover (Red Films production types, meetings);
 *   integrity()     — the Company Integrity Register derived from the SAME reads.
 *
 * Future positions (WorkPosition, MoneyPosition, LabelPosition, SchedulePosition, SalesPosition, TeamPosition,
 * MemoryContext, EvidenceTimeline) are meant to be added here as further memoized derivations over the same reads —
 * none is built yet. Money always comes from the Finance Brain (financeLive), never recomputed. Nothing is cached
 * across requests and nothing is written. Residual: sources are separate SELECTs milliseconds apart (no
 * cross-source snapshot transaction), same as Gateway V1.
 */
import { supabase } from "@/lib/supabase";
import { createGatewayReadContext, APP_IDENTITIES, type GatewayReadContext } from "../gateway/read-context";
import { resolveCurrentOwnerContexts } from "../investigation/context-store";
import type { PersistedOwnerContext } from "../investigation/context-row";
import { ilYmd } from "../../coo/dates";
import { PORTAL_ARTISTS } from "../../red-artists/portal-registry";
import { buildCompanyIntegrityRegister } from "../integrity/register";
import type { IntegrityExtras } from "../integrity/detectors";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { readIntegrityExtras, type CompanyExtrasReadClient } from "./readers";
import { createOwnerKnowledgeStore, type OwnerKnowledgeRecord, type OwnerKnowledgeTableClient } from "../owner-knowledge/store";
import type { Avail } from "../gateway/core";
import { readOperationsRaw, type OperationsRaw, type OperationsReadClient } from "../operations/readers";

export const ownerKnowledgeEnabled = () => process.env.PARTNER_OWNER_KNOWLEDGE_ENABLED === "true";

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

export interface CompanyReadContext extends GatewayReadContext {
  todayIL: string;
  /** Sunny organizational memory. undefined = the store is not enabled here (PARTNER_OWNER_KNOWLEDGE_ENABLED). */
  ownerKnowledge(): Promise<Avail<OwnerKnowledgeRecord[]> | undefined>;
  /** Operations domains (SELECT only, narrow columns, per-section fail closed). */
  operations(): Promise<Avail<OperationsRaw>>;
  ownerContexts(): Promise<PersistedOwnerContext[] | null>;
  extras(): Promise<IntegrityExtras | null>;
  integrity(): Promise<CompanyIntegrityRegister>;
}

export function createCompanyReadContext(now: Date = new Date()): CompanyReadContext {
  const g = createGatewayReadContext(now);
  const todayIL = ilYmd(now);
  const ownerContexts = once(async () => {
    try {
      const r = await resolveCurrentOwnerContexts();
      if (r.status === "OK") return r.contexts;
      if (r.status === "NO_CONTEXT") return [];
      return null;
    } catch { return null; }
  });
  const extras = once(async () => {
    try { return await readIntegrityExtras(supabase as unknown as CompanyExtrasReadClient); } catch { return null; }
  });
  const integrity = once(async () => {
    const [state, live, memory, contexts, ex] = await Promise.all([g.state(), g.financeLive(), g.memory(), ownerContexts(), extras()]);
    return buildCompanyIntegrityRegister({
      now, todayIL,
      state: state.status === "OK" ? state.value : null,
      finance: live.status === "OK" ? { raw: live.raw } : null,
      memory: memory?.status === "OK" ? memory.value : null,
      extras: ex,
      portalArtistNames: Object.keys(PORTAL_ARTISTS),
      cleantoneClientId: APP_IDENTITIES.cleantone?.clientId ?? null,
      ownerContexts: contexts,
    });
  });
  const ownerKnowledge = once(async (): Promise<Avail<OwnerKnowledgeRecord[]> | undefined> => {
    if (!ownerKnowledgeEnabled()) return undefined;
    try {
      const r = await createOwnerKnowledgeStore(supabase as unknown as OwnerKnowledgeTableClient).list();
      return r.status === "OK" ? { status: "OK", value: r.records } : { status: "UNAVAILABLE", detail: r.status === "READ_FAILED" ? r.detail : `invalid stored knowledge rows (${r.count})` };
    } catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const operations = once(async (): Promise<Avail<OperationsRaw>> => {
    try { return { status: "OK", value: await readOperationsRaw(supabase as unknown as OperationsReadClient) }; }
    catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  return { ...g, todayIL, ownerContexts, extras, integrity, ownerKnowledge, operations };
}
