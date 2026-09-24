/**
 * Redbloods Partner — Unified Knowledge: the generic query core (partner_query) + partner_entity enrichment. Pure.
 *
 * Order of checks for a query (nothing is read before all pass):
 *   1. capability id: registered AND visible to this audience — otherwise UNKNOWN_CAPABILITY (an INTERNAL-only
 *      capability is indistinguishable from a non-existent one for an external caller);
 *   2. Owner authority when the capability is ownerOnly — otherwise NOT_AUTHORIZED;
 *   3. mode ∈ declared modes; params: only declared keys, each validated by its typed spec (enum / bounded text /
 *      entity key of an allowed type / real date) — otherwise INVALID_REQUEST;
 *   4. limit within the capability's paging; cursor bound to the SAME capability + mode + params — otherwise INVALID_CURSOR.
 * Then the capability's PURE reader runs over the request's sources and the core pages the deterministic result.
 * Record text is length-capped; every item keeps its epistemic status, freshness, source and relation quality.
 */
import { canonicalStableStringify, sha256Hex } from "../actions/canonical";
import { isValidYmd } from "../investigation/answer-value";
import { parseEntityKey } from "../gateway/keys";
import { ok, partner } from "../gateway/core";
import { GATEWAY_SCHEMA_VERSION, GATEWAY_TEXT_POLICY, type GText, type GatewaySourceName } from "../gateway/types";
import type { KnowledgeRegistry } from "./registry";
import {
  KNOWLEDGE_SCHEMA_VERSION,
  type EntityKnowledgeSection, type KnowledgeAudience, type KnowledgeCapability, type KnowledgeItem, type KnowledgeReadResult,
  type KnowledgeRequest, type KnowledgeSourceNeed, type KnowledgeSources, type QueryResponse, type QueryStatus,
} from "./types";

export const RESTRICTIVE_AUDIENCE: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_RECORD_TEXT = 300;
const MAX_OFFSET = 10_000;

const SOURCE_NAME: Record<KnowledgeSourceNeed, GatewaySourceName> = { STATE: "PROJECTS", FINANCE: "FINANCE", MEMORY: "MEMORY", CASES: "CASES", ACTIONS: "ACTIONS", OUTCOMES: "OUTCOMES", INTEGRITY: "INTEGRITY", OWNER_KNOWLEDGE: "OWNER_KNOWLEDGE" };
const SOURCE_OF: Record<KnowledgeSourceNeed, (s: KnowledgeSources) => unknown> = {
  STATE: (s) => s.state, FINANCE: (s) => s.finance, MEMORY: (s) => s.memory, CASES: (s) => s.cases, ACTIONS: (s) => s.actions, OUTCOMES: (s) => s.outcomes, INTEGRITY: (s) => s.integrity,
  OWNER_KNOWLEDGE: (s) => s.ownerKnowledge,
};

export type ValidatedQuery = { cap: KnowledgeCapability; mode: string; params: Record<string, string>; limit: number; offset: number };

function fail(code: QueryStatus, message: string) { return { ok: false as const, code, message }; }

/** Steps 1–4. Pure; reads nothing. */
export function validateKnowledgeRequest(registry: KnowledgeRegistry, req: KnowledgeRequest, audience: KnowledgeAudience):
  | { ok: true; value: ValidatedQuery } | { ok: false; code: QueryStatus; message: string } {
  const cap = registry.get(String(req.capability ?? ""));
  if (!cap || !registry.visibleTo(cap, audience)) return fail("UNKNOWN_CAPABILITY", "No such Partner capability. Use capability \"catalog\" to see what Partner can answer.");
  if (!registry.allowed(cap, audience)) return fail("NOT_AUTHORIZED", "This Partner knowledge needs the Owner's authority.");
  const mode = req.mode ?? cap.defaultMode;
  if (typeof mode !== "string" || !Object.prototype.hasOwnProperty.call(cap.modes, mode)) return fail("INVALID_REQUEST", `mode must be one of: ${Object.keys(cap.modes).join(", ")}`);
  const raw = req.params ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("INVALID_REQUEST", "params must be an object");
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const spec = Object.prototype.hasOwnProperty.call(cap.params, k) ? cap.params[k] : null;
    if (!spec) return fail("INVALID_REQUEST", `unknown param "${k}" (allowed: ${Object.keys(cap.params).join(", ") || "none"})`);
    if (typeof v !== "string") return fail("INVALID_REQUEST", `param "${k}" must be a string`);
    const val = v.trim();
    if (spec.kind === "enum" && !spec.values.includes(val)) return fail("INVALID_REQUEST", `param "${k}" must be one of: ${spec.values.join(", ")}`);
    if (spec.kind === "text" && (!val || val.length > spec.maxLength || CONTROL.test(val))) return fail("INVALID_REQUEST", `param "${k}" must be 1–${spec.maxLength} printable characters`);
    if (spec.kind === "entityKey") {
      const parsed = parseEntityKey(val);
      if (!parsed || !spec.types.includes(parsed.type as never)) return fail("INVALID_REQUEST", `param "${k}" must be a Partner entity key of type ${spec.types.join(" / ")} (use partner_resolve)`);
    }
    if (spec.kind === "ymd" && !isValidYmd(val)) return fail("INVALID_REQUEST", `param "${k}" must be a date YYYY-MM-DD`);
    params[k] = val;
  }
  const limit = req.limit ?? cap.paging.defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > cap.paging.maxLimit) return fail("INVALID_REQUEST", `limit must be 1–${cap.paging.maxLimit}`);
  let offset = 0;
  if (req.cursor !== undefined) {
    const c = decodeCursor(req.cursor);
    if (!c || c.c !== cap.id || c.m !== mode || c.h !== paramsHash(params) || c.o > MAX_OFFSET) return fail("INVALID_CURSOR", "cursor does not belong to this query (repeat the query without a cursor)");
    offset = c.o;
  }
  return { ok: true, value: { cap, mode, params, limit, offset } };
}

const paramsHash = (p: Record<string, string>) => sha256Hex(canonicalStableStringify(p)).slice(0, 16);
function encodeCursor(c: { c: string; m: string; h: string; o: number }): string { return Buffer.from(JSON.stringify({ v: 1, ...c })).toString("base64url"); }
function decodeCursor(s: unknown): { c: string; m: string; h: string; o: number } | null {
  if (typeof s !== "string" || s.length > 300 || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const j = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;
    if (j.v !== 1 || typeof j.c !== "string" || typeof j.m !== "string" || typeof j.h !== "string" || !Number.isInteger(j.o) || (j.o as number) < 0) return null;
    return { c: j.c, m: j.m, h: j.h, o: j.o as number };
  } catch { return null; }
}

/** Record text is DATA: capped, never trusted. */
function capText(g: GText): GText { return g.trust === "PARTNER" || g.text.length <= MAX_RECORD_TEXT ? g : { text: `${g.text.slice(0, MAX_RECORD_TEXT)}…`, trust: g.trust }; }
function capItem(i: KnowledgeItem): KnowledgeItem {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(i.fields)) fields[k] = v && typeof v === "object" && "trust" in (v as object) && "text" in (v as object) ? capText(v as GText) : v;
  return { ...i, label: capText(i.label), fields };
}

function sourceStatuses(cap: KnowledgeCapability, src: KnowledgeSources) {
  return cap.needs.map((n) => {
    const a = SOURCE_OF[n](src) as { status?: string } | undefined;
    const up = !!a && a.status === "OK";
    return { source: SOURCE_NAME[n], status: up ? ("OK" as const) : ("UNAVAILABLE" as const), freshness: up ? ("LIVE" as const) : ("UNKNOWN" as const) };
  });
}

function runReader(cap: KnowledgeCapability, src: KnowledgeSources, mode: string, params: Record<string, string>): KnowledgeReadResult {
  try {
    return cap.read(src, { mode, params });
  } catch {
    return { items: [], summary: [], completeness: "UNKNOWN", coverage: [], missing: [{ fact: cap.id, whyNeeded: "this Partner knowledge could not be derived right now — nothing here means \"none\"" }] };
  }
}

export function queryKnowledgeCore(registry: KnowledgeRegistry, req: KnowledgeRequest, src: KnowledgeSources, audience: KnowledgeAudience): QueryResponse {
  const query: Record<string, string> = { capability: String(req.capability ?? "").slice(0, 40), ...(req.mode ? { mode: String(req.mode).slice(0, 30) } : {}) };
  const base = { schemaVersion: GATEWAY_SCHEMA_VERSION, knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION as typeof KNOWLEDGE_SCHEMA_VERSION, tool: "partner_query" as const, query, asOf: src.now.toISOString(), textPolicy: GATEWAY_TEXT_POLICY };
  const v = validateKnowledgeRequest(registry, req, audience);
  if (!v.ok) {
    return { ...base, freshness: "UNKNOWN", sources: [], status: v.code, capability: null, mode: null, params: {}, completeness: null, coverage: [], summary: [], items: [], page: null, missing: [],
      drillDown: [{ tool: "partner_query", args: { capability: "catalog" }, label: partner("מה Partner יודע") }], error: { code: v.code, message: v.message } };
  }
  const { cap, mode, params, limit, offset } = v.value;
  const sources = sourceStatuses(cap, src);
  // readers never decide access; the catalog uses the audience only to list what THIS caller may read
  const r = runReader(cap, { ...src, audience }, mode, params);
  const page = r.items.slice(offset, offset + limit).map(capItem);
  const next = offset + limit < r.items.length ? encodeCursor({ c: cap.id, m: mode, h: paramsHash(params), o: offset + limit }) : null;
  const completeness = sources.some((s) => s.status !== "OK") ? "UNKNOWN" : r.completeness;
  return {
    ...base, freshness: sources.every((s) => s.status === "OK") ? "LIVE" : "UNKNOWN", sources,
    status: "OK", capability: { id: cap.id, domain: cap.domain, title: cap.titleHe }, mode, params,
    completeness, coverage: r.coverage.map(capText), summary: r.summary, items: page,
    page: { limit, offset, returned: page.length, total: r.items.length, nextCursor: next },
    missing: [...r.missing, ...sources.filter((s) => s.status !== "OK").map((s) => ({ fact: s.source, whyNeeded: "this source could not be read — missing items do not mean \"none\"" }))],
    drillDown: [], error: null,
  };
}

/**
 * partner_entity enrichment: every capability whose entityScope includes this entity type, that this audience may
 * read, is run with the entity key — bounded to its entityScope.limit. No per-capability code anywhere else.
 */
export function entityKnowledge(registry: KnowledgeRegistry, src: KnowledgeSources, entityKey: string): EntityKnowledgeSection[] {
  const parsed = parseEntityKey(entityKey);
  if (!parsed) return [];
  const audience = src.audience ?? RESTRICTIVE_AUDIENCE;
  const out: EntityKnowledgeSection[] = [];
  for (const cap of registry.all()) {
    const scope = cap.entityScope;
    if (!scope || !scope.types.includes(parsed.type as never) || !registry.allowed(cap, audience)) continue;
    if (cap.needs.some((n) => !(SOURCE_OF[n](src) as { status?: string } | undefined))) continue; // source not loaded for this request
    const r = runReader(cap, src, scope.mode, { [scope.param]: entityKey });
    if (!r.items.length && !r.summary.length && r.completeness === "COMPLETE") continue;
    const unavailable = cap.needs.some((n) => (SOURCE_OF[n](src) as { status?: string }).status !== "OK");
    out.push({ capability: cap.id, title: cap.titleHe, completeness: unavailable ? "UNKNOWN" : r.completeness, summary: r.summary.slice(0, 6), items: r.items.slice(0, scope.limit).map(capItem), total: r.items.length, coverage: r.coverage.map(capText) });
  }
  return out;
}

/** Which sources a query needs (the server loads only these). */
export function sourcesNeeded(registry: KnowledgeRegistry, capabilityId: string): readonly KnowledgeSourceNeed[] {
  return registry.get(capabilityId)?.needs ?? [];
}

export { ok };
