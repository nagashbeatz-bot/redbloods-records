/**
 * Redbloods Partner — Unified Knowledge: the capability registry (the read ALLOWLIST). Pure.
 *
 * A registry is built from an explicit list of KnowledgeCapability objects (lib/partner/knowledge/catalog.ts for
 * production). Lookup is by exact id in a Map — never by module path, function name or dynamic import. Definitions
 * are validated when the registry is built (a malformed capability fails at startup / in tests, never at query time).
 */
import type { CapabilityDescriptor, KnowledgeAudience, KnowledgeCapability, KnowledgeDomain } from "./types";

export const CAPABILITY_ID_RE = /^[a-z][a-z0-9_]{2,33}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,29}$/;
export const KNOWLEDGE_MAX_LIMIT = 50;

export interface KnowledgeRegistry {
  readonly version: string;
  get(id: string): KnowledgeCapability | null;
  all(): readonly KnowledgeCapability[];
  /** Is this capability visible to this audience? (external interfaces never see INTERNAL-only capabilities) */
  visibleTo(cap: KnowledgeCapability, audience: KnowledgeAudience): boolean;
  /** May this audience read it right now? (visible + Owner authority when ownerOnly) */
  allowed(cap: KnowledgeCapability, audience: KnowledgeAudience): boolean;
  describe(audience: KnowledgeAudience, domain?: KnowledgeDomain): CapabilityDescriptor[];
}

export function validateCapability(c: KnowledgeCapability): string[] {
  const e: string[] = [];
  if (!CAPABILITY_ID_RE.test(c.id)) e.push(`${c.id}: id must match ${CAPABILITY_ID_RE}`);
  if (!c.descriptionForModel || c.descriptionForModel.length > 900) e.push(`${c.id}: descriptionForModel must be 1–900 chars`);
  if (!Object.keys(c.modes).length || !Object.keys(c.modes).every((m) => NAME_RE.test(m))) e.push(`${c.id}: modes must be non-empty lowercase names`);
  if (!(c.defaultMode in c.modes)) e.push(`${c.id}: defaultMode must be one of its modes`);
  for (const [k, p] of Object.entries(c.params)) {
    if (!NAME_RE.test(k)) e.push(`${c.id}: param ${k} must be a lowercase name`);
    if (p.kind === "enum" && (!p.values.length || p.values.length > 40)) e.push(`${c.id}: enum ${k} needs 1–40 values`);
    if (p.kind === "text" && (p.maxLength < 1 || p.maxLength > 120)) e.push(`${c.id}: text ${k} maxLength must be 1–120`);
  }
  if (c.recordTextLimit !== undefined && (!Number.isInteger(c.recordTextLimit) || c.recordTextLimit < 300 || c.recordTextLimit > 4000)) e.push(`${c.id}: recordTextLimit must be 300–4000`);
  if (Object.keys(c.params).length > 6) e.push(`${c.id}: at most 6 params`);
  if (c.paging.defaultLimit < 1 || c.paging.maxLimit > KNOWLEDGE_MAX_LIMIT || c.paging.defaultLimit > c.paging.maxLimit) e.push(`${c.id}: paging must be 1 ≤ default ≤ max ≤ ${KNOWLEDGE_MAX_LIMIT}`);
  if (c.entityScope) {
    const p = c.params[c.entityScope.param];
    if (!p || p.kind !== "entityKey") e.push(`${c.id}: entityScope.param must be an entityKey param`);
    if (!(c.entityScope.mode in c.modes)) e.push(`${c.id}: entityScope.mode must be one of its modes`);
    if (c.entityScope.limit < 1 || c.entityScope.limit > 10) e.push(`${c.id}: entityScope.limit must be 1–10`);
  }
  return e;
}

export function createKnowledgeRegistry(capabilities: readonly KnowledgeCapability[]): KnowledgeRegistry {
  const errors = capabilities.flatMap(validateCapability);
  const ids = capabilities.map((c) => c.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) errors.push(`duplicate capability ids: ${[...new Set(dup)].join(", ")}`);
  if (errors.length) throw new Error(`invalid Partner knowledge registry:\n${errors.join("\n")}`);
  const map = new Map(capabilities.map((c) => [c.id, c]));
  const visibleTo = (c: KnowledgeCapability, a: KnowledgeAudience) => a.channel === "INTERNAL" || c.access.externalRead;
  const allowed = (c: KnowledgeCapability, a: KnowledgeAudience) => visibleTo(c, a) && (!c.access.ownerOnly || a.ownerAuthorized);
  return {
    version: `r${capabilities.length}:${[...ids].sort().join(",").length}`,
    get: (id) => (typeof id === "string" && map.has(id) ? map.get(id)! : null),
    all: () => capabilities,
    visibleTo,
    allowed,
    describe(audience, domain) {
      return capabilities.filter((c) => allowed(c, audience) && (!domain || c.domain === domain)).map((c): CapabilityDescriptor => ({
        id: c.id, domain: c.domain, title: c.titleHe, description: c.descriptionForModel, examples: [...c.examplesHe],
        modes: Object.fromEntries(Object.entries(c.modes).map(([k, v]) => [k, v.descriptionForModel])), defaultMode: c.defaultMode,
        params: Object.fromEntries(Object.entries(c.params).map(([k, p]) => [k, {
          kind: p.kind, description: p.descriptionForModel,
          ...(p.kind === "enum" ? { values: [...p.values] } : {}), ...(p.kind === "text" ? { maxLength: p.maxLength } : {}), ...(p.kind === "entityKey" ? { entityTypes: [...p.types] } : {}),
        }])),
        paging: { ...c.paging }, ownerOnly: c.access.ownerOnly, sensitivity: c.access.sensitivity, entityScope: c.entityScope ? [...c.entityScope.types] : [],
      }));
    },
  };
}
