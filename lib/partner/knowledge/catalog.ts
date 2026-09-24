/**
 * Redbloods Partner — THE registered knowledge capabilities (the explicit read allowlist).
 *
 * Adding Partner READ knowledge = add a capability here (see the rule in ./types.ts). It then reaches every Partner
 * interface automatically — the Redbloods OS knowledge route, the Gateway (partner_query + partner_entity enrichment)
 * and the Claude MCP connector — with no interface-specific code. Writes are never registered here.
 */
import { getPartnerBriefCore } from "../gateway/brief";
import { createKnowledgeRegistry, type KnowledgeRegistry } from "./registry";
import type { KnowledgeCapability } from "./types";
import { item, result } from "./capabilities/common";
import { cases, catalogCapability, integrity, knownUnknowns, memory, outcomes, ownerDecisions, ownerNeeds } from "./capabilities/partner";
import { financeFlows, financeIntegrity, financePosition, financeReceivables, victorSalary } from "./capabilities/finance";
import { clients, projects, proposals, sessions, teamSteven, teamVictor } from "./capabilities/work";
import { labelRoster, releases, shows } from "./capabilities/label";
import { improvementSignals, ownerKnowledge, relations } from "./capabilities/sunny";

const brief: KnowledgeCapability = {
  id: "brief", domain: "COMPANY", titleHe: "מה חשוב עכשיו",
  descriptionForModel: "What matters in the company right now (at most 5 items: actions ready for the Owner, Owner decisions needed, attention, money, recent outcomes) — the same orientation as the partner_brief tool.",
  examplesHe: ["מה חשוב עכשיו?", "מה המצב?", "על מה לשים לב היום?"],
  modes: { now: { descriptionForModel: "Current orientation" } }, defaultMode: "now",
  params: {}, paging: { defaultLimit: 5, maxLimit: 5 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" },
  needs: ["FINANCE", "CASES", "ACTIONS", "OUTCOMES", "MEMORY", "INTEGRITY"],
  read(src) {
    const b = getPartnerBriefCore(src);
    return result(b.items.map((i, n) => item({ id: `${i.category}:${n}`, entity: i.subject, label: i.headline, epistemic: i.epistemic, freshness: i.freshness, source: i.source, fields: { category: i.category } })),
      { missing: b.missing, completeness: b.missing.length ? "PARTIAL" : "COMPLETE" });
  },
};

/** Every production capability, in catalog order. Registration here is an explicit, reviewed code change. */
export const PARTNER_KNOWLEDGE_CAPABILITIES: readonly KnowledgeCapability[] = [
  brief, ownerNeeds, knownUnknowns, cases, integrity, outcomes, ownerDecisions, memory,
  financePosition, financeReceivables, financeFlows, financeIntegrity,
  projects, clients, proposals,
  labelRoster, releases, shows,
  sessions,
  teamVictor, teamSteven, victorSalary,
  ownerKnowledge, relations, improvementSignals,
];

/** The registry = catalog capability (bound to itself) + the given capabilities. Tests may add capabilities; production uses none. */
export function buildPartnerKnowledgeRegistry(extra: readonly KnowledgeCapability[] = []): KnowledgeRegistry {
  let registry: KnowledgeRegistry | null = null;
  registry = createKnowledgeRegistry([catalogCapability(() => registry!), ...PARTNER_KNOWLEDGE_CAPABILITIES, ...extra]);
  return registry;
}

export const PARTNER_KNOWLEDGE_REGISTRY: KnowledgeRegistry = buildPartnerKnowledgeRegistry();
