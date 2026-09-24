import "server-only";

/**
 * Sunny organizational memory — server binding (P2). Used ONLY by the MCP connector's partner_propose_knowledge, which
 * exists only when PARTNER_MCP_KNOWLEDGE_ENABLED=true on the MCP-only connector (and requires the P2 schema).
 *
 *   isOwner   — re-verifies at preview AND commit time that the token's user is STILL the Redbloods Owner (fail closed).
 *   loadLive  — ONE request-scoped CompanyReadContext: company state + finance (read-only, for conflict / gap checks)
 *               + the knowledge rows (strict parse; any unreadable row → UNAVAILABLE, never partial memory).
 *   store     — the append-only partner_owner_knowledge store: the ONLY write this module can make.
 *   freshRecords — a brand-new read after the write (verification).
 * No business table, Finance record, Owner Context row or action is written from here.
 */
import { supabase } from "@/lib/supabase";
import { isRedbloodsOwner } from "../bridge/server";
import { createCompanyReadContext } from "../company/read-context";
import { APP_IDENTITIES } from "../gateway/read-context";
import type { GatewaySources } from "../gateway/core";
import type { KnowledgeLiveFacts } from "./kinds";
import { commitKnowledgeCore, createNonceGuard, previewKnowledgeCore, type KnowledgeActor, type KnowledgeProposeDeps } from "./propose";
import { createOwnerKnowledgeStore, type OwnerKnowledgeTableClient } from "./store";

const store = createOwnerKnowledgeStore(supabase as unknown as OwnerKnowledgeTableClient);
const consumeNonce = createNonceGuard();

function liveFacts(src: GatewaySources, todayIL: string): KnowledgeLiveFacts {
  const st = src.state?.status === "OK" ? src.state.value : null;
  const fin = src.finance?.status === "OK" ? src.finance.value : null;
  return {
    todayIL,
    projectStatus: (id) => st?.domains.projects.data?.index[id]?.status ?? null,
    financeMatch: ({ subjectKey, direction, amount, currency }) => {
      // Only a project-scoped report can be matched deterministically against canonical transactions; else unknown.
      if (!fin || !subjectKey.startsWith("project:")) return null;
      const pid = subjectKey.slice("project:".length);
      const type = direction === "RECEIVED" ? "income" : "expense";
      return fin.raw.transactions.some((t) => t.projectId === pid && t.type === type && Number(t.amount) === amount && (t.currency ?? "₪") === currency);
    },
  };
}

function deps(secret: string): KnowledgeProposeDeps {
  return {
    secret,
    nowMs: () => Date.now(),
    isOwner: isRedbloodsOwner,
    async loadLive() {
      const ctx = createCompanyReadContext();
      const [state, finance, records] = await Promise.all([ctx.state(), ctx.finance(), store.list()]);
      if (state.status !== "OK") return { ok: false, detail: "company state unavailable" };
      if (records.status !== "OK") return { ok: false, detail: records.status === "READ_FAILED" ? "knowledge unavailable" : "stored knowledge unreadable" };
      const src: GatewaySources = { now: ctx.now, state, finance, identities: APP_IDENTITIES };
      return { ok: true, live: { src, records: records.records, facts: liveFacts(src, state.value.todayIL) } };
    },
    store,
    async freshRecords() {
      const r = await createOwnerKnowledgeStore(supabase as unknown as OwnerKnowledgeTableClient).list();
      return r.status === "OK" ? r.records : null;
    },
    consumeNonce,
  };
}

export function previewKnowledgeViaConnector(secret: string, i: { items: unknown; actor: KnowledgeActor }) {
  return previewKnowledgeCore(deps(secret), i.actor, i.items);
}

export function commitKnowledgeViaConnector(secret: string, i: { items: unknown; confirmationToken: string; actor: KnowledgeActor; attemptAuditId: string }) {
  return commitKnowledgeCore(deps(secret), i.actor, i.items, i.confirmationToken, i.attemptAuditId);
}
