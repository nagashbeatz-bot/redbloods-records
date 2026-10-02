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
import { LABEL_PORTAL_NAMES } from "../../red-artists/portal-registry";
import { buildCompanyIntegrityRegister } from "../integrity/register";
import type { IntegrityExtras } from "../integrity/detectors";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { readIntegrityExtras, type CompanyExtrasReadClient } from "./readers";
import { createOwnerKnowledgeStore, withIdentityAliases, type OwnerKnowledgeRecord, type OwnerKnowledgeTableClient } from "../owner-knowledge/store";
import type { Avail } from "../gateway/core";
import { readBrainSnapshot, type BrainReadClient } from "../../brain-store";
import type { BrainSnapshot } from "../brain/model";
import { readOperationsRaw, type OperationsRaw, type OperationsReadClient } from "../operations/readers";
import { readProjectDetailRaw } from "../projects/detail-reader";
import type { ProjectDetailRaw } from "../projects/detail-types";
import { readClientDetailRaw } from "../clients/detail-reader";
import type { ClientDetailRaw } from "../clients/detail-types";
import { readLabelDetailRaw } from "../label/detail-reader";
import type { LabelDetailRaw } from "../label/detail-types";
import { readSettingsState } from "../settings/reader";
import type { SettingsState } from "../settings/types";
import type { CalendarWindowResult } from "../calendar/types";

import { createOwnerInboxStore, type OwnerInboxClient } from "../../owner-inbox-store";
import type { OwnerInboxItem } from "../../owner-inbox";
import type { InboxMemory } from "../../inbox-memory";
import { createInboxMemoryStore, type InboxMemoryClient } from "../../inbox-memory-store";
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
  /** Project human context + file metadata (SELECT only, per-section fail closed, secrets reduced to booleans). */
  projectDetail(): Promise<Avail<ProjectDetailRaw>>;
  /** Client contact details / notes + the text of transactions with no project (SELECT only, per-section fail closed). */
  clientDetail(): Promise<Avail<ClientDetailRaw>>;
  /** Label artists in full: artist record, ledger, cycles, media income, beats, shows (SELECT only, per-section fail closed). */
  labelDetail(): Promise<Avail<LabelDetailRaw>>;
  /** Registered non-secret settings families (bounded; never credentials). */
  settings(): Promise<Avail<SettingsState>>;
  /** "עדכון לסאני" (sunny_owner_inbox, SELECT only, bounded): the Owner's free-text updates — OWNER_REPORTED evidence. */
  ownerInbox(): Promise<Avail<OwnerInboxItem[]>>;
  /** Sunny's memory of those updates (sunny_inbox_links / _interpretations, SELECT only, bounded) — HYPOTHESIS, never canonical. */
  inboxMemory(): Promise<Avail<InboxMemory>>;
  /** Sunny Brain v1 + T2 queue (bounded SELECTs; NOT_INSTALLED before the migration — never "empty"). */
  brain(): Promise<Avail<BrainSnapshot>>;
  /** Live Google Calendar window (Israel dates). MAIN: the trusted integration directly; connector: MAIN's internal endpoint. */
  calendar(startYmd: string, endYmd: string): Promise<Avail<CalendarWindowResult>>;
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
      portalArtistNames: [...LABEL_PORTAL_NAMES],
      ownerContexts: contexts,
    });
  });
  const ownerKnowledge = once(async (): Promise<Avail<OwnerKnowledgeRecord[]> | undefined> => {
    if (!ownerKnowledgeEnabled()) return undefined;
    try {
      const r = await createOwnerKnowledgeStore(supabase as unknown as OwnerKnowledgeTableClient).list();
      // DJ CLEANTONE's retired label-artist key (Owner knowledge recorded before 2026-09-27) → his live DJ / client identity
      const ct = APP_IDENTITIES.cleantone;
      const aliases: Record<string, readonly string[]> = ct ? Object.fromEntries(ct.retiredKeys.map((k) => [k, [`dj:${ct.clientId}`, `client:${ct.clientId}`]])) : {};
      return r.status === "OK" ? { status: "OK", value: withIdentityAliases(r.records, aliases) } : { status: "UNAVAILABLE", detail: r.status === "READ_FAILED" ? r.detail : `invalid stored knowledge rows (${r.count})` };
    } catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const ownerInbox = once(async (): Promise<Avail<OwnerInboxItem[]>> => {
    try {
      const r = await createOwnerInboxStore(supabase as unknown as OwnerInboxClient).list(200);
      if (r.status !== "OK") return { status: "UNAVAILABLE", detail: r.detail };
      return r.invalidRows ? { status: "UNAVAILABLE", detail: `invalid stored inbox rows (${r.invalidRows})` } : { status: "OK", value: r.items };
    } catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const inboxMemory = once(async (): Promise<Avail<InboxMemory>> => {
    try {
      const r = await createInboxMemoryStore(supabase as unknown as InboxMemoryClient).readAll();
      return r.status === "OK" ? { status: "OK", value: r.value } : { status: "UNAVAILABLE", detail: r.detail };
    } catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const brain = once(async (): Promise<Avail<BrainSnapshot>> => {
    try {
      const r = await readBrainSnapshot(supabase as unknown as BrainReadClient);
      return r.status === "OK" ? { status: "OK", value: r.value } : { status: "UNAVAILABLE", detail: `${r.status}: ${r.detail}`.slice(0, 200) };
    } catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const operations = once(async (): Promise<Avail<OperationsRaw>> => {
    try { return { status: "OK", value: await readOperationsRaw(supabase as unknown as OperationsReadClient) }; }
    catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const projectDetail = once(async (): Promise<Avail<ProjectDetailRaw>> => {
    try { return { status: "OK", value: await readProjectDetailRaw(supabase as unknown as OperationsReadClient) }; }
    catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const clientDetail = once(async (): Promise<Avail<ClientDetailRaw>> => {
    try { return { status: "OK", value: await readClientDetailRaw(supabase as unknown as OperationsReadClient) }; }
    catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const labelDetail = once(async (): Promise<Avail<LabelDetailRaw>> => {
    try { return { status: "OK", value: await readLabelDetailRaw(supabase as unknown as OperationsReadClient) }; }
    catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const settings = once(async (): Promise<Avail<SettingsState>> => {
    try { return { status: "OK", value: await readSettingsState(supabase as unknown as OperationsReadClient) }; }
    catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
  });
  const calendarMemo = new Map<string, Promise<Avail<CalendarWindowResult>>>();
  const calendar = (startYmd: string, endYmd: string): Promise<Avail<CalendarWindowResult>> => {
    const key = `${startYmd}|${endYmd}`;
    if (!calendarMemo.has(key)) calendarMemo.set(key, (async (): Promise<Avail<CalendarWindowResult>> => {
      try {
        if (process.env.REDBLOODS_MCP_ONLY === "true") {
          const { fetchCalendarWindowRemote } = await import("../calendar/remote");
          return { status: "OK", value: await fetchCalendarWindowRemote(startYmd, endYmd) };
        }
        const [{ readCalendarWindowCore }, { googleCalendarApi }] = await Promise.all([import("../calendar/read-core"), import("../calendar/google-api")]);
        return { status: "OK", value: await readCalendarWindowCore(googleCalendarApi(), startYmd, endYmd) };
      } catch (e) { return { status: "UNAVAILABLE", detail: (e as Error).message.slice(0, 200) }; }
    })());
    return calendarMemo.get(key)!;
  };
  return { ...g, todayIL, ownerContexts, extras, integrity, ownerKnowledge, ownerInbox, inboxMemory, brain, operations, projectDetail, clientDetail, labelDetail, settings, calendar };
}
