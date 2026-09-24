/**
 * Tests — Sunny V1: organizational memory (P2 code), business-action proposals (P3 preview-only), Sunny identity,
 * the knowledge MCP tool behind its switch, and P1 non-regression of the scope model.
 *
 * Run with:   npx tsx scripts/test-sunny.tsx
 *
 * NEVER touches production. The knowledge store runs over an in-memory table that enforces the SAME invariants as the
 * P2 SQL candidate (typed row shape, one commit per confirmation, one root per slot, one successor, same-slot
 * supersession); the SQL itself is proven separately by the Docker harness (C:/Redbloods-F1G-Test/mcp/p2).
 */
import fs from "node:fs";
import path from "node:path";
import { KNOWLEDGE_KINDS, validateKnowledgeKinds, type KnowledgeKind } from "../lib/partner/owner-knowledge/kinds";
import { createOwnerKnowledgeStore, activeKnowledge, mapOwnerKnowledgeRow, OWNER_KNOWLEDGE_TABLE, type OwnerKnowledgeRecord, type OwnerKnowledgeTableClient } from "../lib/partner/owner-knowledge/store";
import { commitKnowledgeCore, createNonceGuard, previewKnowledgeCore, TOKEN_TTL_MS, type KnowledgeProposeDeps } from "../lib/partner/owner-knowledge/propose";
import { proposeActionPreviewCore } from "../lib/partner/sunny/action-proposal";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { entityKnowledge, queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildCompanyIntegrityRegister } from "../lib/partner/integrity/register";
import { parseContextProvenance } from "../lib/partner/investigation/context-row";
import { readMcpConfig, scopeString, hasKnowledgeScope, ANSWER_SCOPE_STRING, MCP_SCOPE } from "../lib/integrations/partner-mcp/config";
import { advertisedScope, grantedScope, insufficientScopeResponse } from "../lib/integrations/partner-mcp/oauth";
import { protectedResourceMetadata, authorizationServerMetadata } from "../lib/integrations/partner-mcp/metadata";
import { handleMcpHttp, SERVER_INFO, SERVER_INSTRUCTIONS, type McpDeps } from "../lib/integrations/partner-mcp/mcp";
import { KNOWLEDGE_KINDS_FOR_TOOL, TOOL_NAMES, validateToolCall, buildToolDefinitions } from "../lib/integrations/partner-mcp/tools";
import { isAllowedMcpOnlyFetch } from "../lib/integrations/partner-mcp/mcp-only";
import { SlidingWindowLimiter } from "../lib/integrations/partner-mcp/rate-limit";
import type { AuditRow } from "../lib/integrations/partner-mcp/store";
import { NOW, P, U, LA_CLEAN, C_CLEAN, LA_SHALEV, input, financeRaw } from "./fixtures/integrity-company";
import { BASE_ENV } from "./fixtures/mcp-oauth-scenarios";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

const OWNER_ID = "0f0f0f0f-0000-4000-8000-00000000a0a0";
const CLIENT = "rbmcp_" + "c".repeat(40);
const TOKEN_ID = "00000000-0000-4000-8000-00000000abcd";
const ACTOR = { userId: OWNER_ID, clientId: CLIENT, tokenId: TOKEN_ID };
const SECRET = "s".repeat(48);
const OWNER_EXT: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const IDS: GatewaySources["identities"] = { cleantone: { clientId: C_CLEAN, labelArtistName: "DJ CLEANTONE" } };

/** Sources over the production-shaped fixture (real engines), with the DJ CLEANTONE canonical app link. */
function sources(knowledge?: OwnerKnowledgeRecord[]): GatewaySources {
  const inp = input({ contexts: [] });
  const st = inp.state!;
  const raw = financeRaw();
  const view = deriveFinanceView(raw, NOW, []);
  const finance: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  return {
    now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: finance }, integrity: { status: "OK", value: buildCompanyIntegrityRegister(inp) },
    memory: { status: "OK", value: { entities: [], patternCandidates: [], confirmedPatterns: [] } as never },
    ...(knowledge ? { ownerKnowledge: { status: "OK" as const, value: knowledge } } : {}), identities: IDS,
  };
}

/** In-memory partner_owner_knowledge with the P2 SQL invariants (mirrors the CHECK / unique / FK set). */
class FakeKnowledgeTable {
  rows: Record<string, unknown>[] = [];
  inserts = 0;
  tablesTouched = new Set<string>();
  failNextInsert: { code: string; message: string } | null = null;
  private n = 0;
  client(): OwnerKnowledgeTableClient {
    return {
      from: (table: string) => {
        this.tablesTouched.add(table);
        return {
          select: () => ({ order: () => ({ range: async (a: number, b: number) => ({ data: table === OWNER_KNOWLEDGE_TABLE ? this.rows.slice(a, b + 1).map((r) => structuredClone(r)) : null, error: table === OWNER_KNOWLEDGE_TABLE ? null : { message: "no such table" } }) }) }),
          insert: (rows: unknown[]) => ({ select: async () => this.insert(table, rows as Record<string, unknown>[]) }),
        };
      },
    };
  }
  private insert(table: string, rows: Record<string, unknown>[]) {
    this.inserts++;
    if (table !== OWNER_KNOWLEDGE_TABLE) return { data: null, error: { code: "42P01", message: "no such table" } };
    if (this.failNextInsert) { const e = this.failNextInsert; this.failNextInsert = null; return { data: null, error: e }; }
    const staged = [...this.rows];
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      const row: Record<string, unknown> = { id: U(9000 + ++this.n), created_at: new Date(NOW.getTime() + this.n * 1000).toISOString(), ...r };
      if (!mapOwnerKnowledgeRow(row)) return { data: null, error: { code: "23514", message: "check constraint violated" } };
      if (staged.some((x) => x.confirmation_id === row.confirmation_id && x.item_index === row.item_index)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_owner_knowledge_confirmation_uk"' } };
      if (row.supersedes_id === null && staged.some((x) => x.slot_key === row.slot_key && x.supersedes_id === null)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_owner_knowledge_slot_root_uk"' } };
      if (row.supersedes_id !== null) {
        if (!staged.some((x) => x.id === row.supersedes_id && x.slot_key === row.slot_key)) return { data: null, error: { code: "23503", message: "violates foreign key constraint partner_owner_knowledge_supersedes_same_slot_fk" } };
        if (staged.some((x) => x.supersedes_id === row.supersedes_id)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_owner_knowledge_supersedes_uk"' } };
      }
      staged.push(row); out.push(row);
    }
    this.rows = staged;
    return { data: out.map((r) => structuredClone(r)), error: null };
  }
}

function world(o: { owner?: boolean } = {}) {
  const table = new FakeKnowledgeTable();
  const store = createOwnerKnowledgeStore(table.client());
  const clock = { now: NOW.getTime() };
  const live = { owner: o.owner ?? true, financeMatch: false as boolean | null, mutateSrc: null as null | ((s: GatewaySources) => GatewaySources) };
  const nonce = createNonceGuard();
  const deps: KnowledgeProposeDeps = {
    secret: SECRET, nowMs: () => clock.now, isOwner: async (u) => live.owner && u === OWNER_ID,
    async loadLive() {
      const r = await store.list();
      if (r.status !== "OK") return { ok: false, detail: r.status };
      let src = sources();
      if (live.mutateSrc) src = live.mutateSrc(src);
      const st = src.state!.status === "OK" ? src.state!.value : null;
      return { ok: true, live: { src, records: r.records, facts: { todayIL: st!.todayIL, projectStatus: (id) => st!.domains.projects.data?.index[id]?.status ?? null, financeMatch: () => live.financeMatch } } };
    },
    store, async freshRecords() { const r = await createOwnerKnowledgeStore(table.client()).list(); return r.status === "OK" ? r.records : null; },
    consumeNonce: (n, e) => nonce(n, e),
  };
  const records = async () => { const r = await store.list(); return r.status === "OK" ? r.records : []; };
  return { table, store, clock, live, deps, records };
}
const CLINTON_ITEMS = [
  { kind: "ORGANIZATIONAL_ROLE", subject: "קלינטון", fields: { role: "LABEL_DJ" } },
  { kind: "ENTITY_RELATIONSHIP", subject: "קלינטון", fields: { relation: "PARTICIPATES_IN_SHOWS", object: "הלייבל", frequency: "MOST" } },
];
type AnyRes = Record<string, unknown> & { status: string };

async function main() {
  section("A. Knowledge Kind Registry (typed, no generic note, never canonical)");
  check("registry is valid", validateKnowledgeKinds(), []);
  const kinds = KNOWLEDGE_KINDS.map((k) => k.kind);
  ok("every required kind exists", ["ENTITY_ALIAS", "ORGANIZATIONAL_ROLE", "ENTITY_RELATIONSHIP", "PROJECT_BLOCKER", "FOLLOW_UP_EXPECTATION", "VENDOR_COMMITMENT", "RELEASE_PRIORITY", "PAYMENT_REPORTED_BY_OWNER", "WORKING_POLICY_CANDIDATE"].every((k) => kinds.includes(k)));
  ok("no NOTE / MEMO / FREE / GENERIC kind", !kinds.some((k) => /NOTE|MEMO|FREE|GENERIC/.test(k)));
  ok("every kind: mutatesCanonicalState === false", KNOWLEDGE_KINDS.every((k) => k.mutatesCanonicalState === false));
  ok("every kind declares subjects, 1–5 typed fields, epistemic, slot, review/expiry, read-back, conflicts", KNOWLEDGE_KINDS.every((k) => k.subjectTypes.length > 0 && Object.keys(k.fields).length >= 1 && Object.keys(k.fields).length <= 5 && !!k.epistemic && typeof k.slot === "function" && typeof k.reviewAt === "function" && typeof k.expiresAt === "function" && typeof k.readBackHe === "function" && typeof k.conflicts === "function"));
  ok("a generic NOTE kind would be rejected by the validator", validateKnowledgeKinds([{ ...KNOWLEDGE_KINDS[0], kind: "OWNER_NOTE" } as KnowledgeKind]).some((e) => /generic/.test(e)));
  ok("a kind that could mutate canonical state would be rejected", validateKnowledgeKinds([{ ...KNOWLEDGE_KINDS[0], mutatesCanonicalState: true } as unknown as KnowledgeKind]).some((e) => /canonical/.test(e)));
  check("the MCP tool's kind enum = the registry", [...KNOWLEDGE_KINDS_FOR_TOOL].sort(), [...kinds].sort());
  const sqlPath = "C:/Redbloods-F1G-Test/mcp/p2/p2-owner-knowledge-forward.sql";
  if (fs.existsSync(sqlPath)) {
    const m = fs.readFileSync(sqlPath, "utf8").match(/kind\s+text not null check \(kind in \(([^)]*)\)\)/);
    check("the P2 SQL kind CHECK = the registry", (m?.[1].match(/'([A-Z_]+)'/g) ?? []).map((x) => x.replace(/'/g, "")).sort(), [...kinds].sort());
  } else ok("(P2 SQL candidate not on this machine — kind parity checked by the harness)", true);
  ok("payment kind is OWNER_REPORTED; policy is a CANDIDATE; frequency note says it is not a booking rule",
    KNOWLEDGE_KINDS.find((k) => k.kind === "PAYMENT_REPORTED_BY_OWNER")!.epistemic === "OWNER_REPORTED" && KNOWLEDGE_KINDS.find((k) => k.kind === "WORKING_POLICY_CANDIDATE")!.epistemic === "OWNER_POLICY_CANDIDATE"
    && KNOWLEDGE_KINDS.find((k) => k.kind === "ENTITY_RELATIONSHIP")!.notesHe.some((n) => n.includes("לא כלל שיבוץ")));

  section("B. Clinton — entity resolution + PREVIEW → CONFIRM → COMMIT → FRESH READ (simulated; nothing real is written)");
  {
    const w = world();
    const pv = (await previewKnowledgeCore(w.deps, ACTOR, CLINTON_ITEMS)) as AnyRes & { items: Array<{ subjectKey: string; identityKeys: string[]; value: Record<string, unknown>; epistemic: string }>; readBackHe: string; confirmationToken: string };
    check("preview status", pv.status, "PREVIEW");
    check("'קלינטון' → ONE canonical subject: the label-artist of the DJ CLEANTONE identity (never a silent pick between people)", pv.items.map((i) => i.subjectKey), [`label-artist:${LA_CLEAN}`, `label-artist:${LA_CLEAN}`]);
    ok("identityKeys carry every key of the same identity (DJ + label-artist)", pv.items[0].identityKeys.includes(`dj:${C_CLEAN}`) && pv.items[0].identityKeys.includes(`label-artist:${LA_CLEAN}`));
    check("'הלייבל' → company:REDBLOODS; frequency MOST", [pv.items[1].value.object, pv.items[1].value.frequency], ["company:REDBLOODS", "MOST"]);
    ok("read-back: 'הבנתי: … ה-DJ של הלייבל … ברוב … לשמור את זה כידע של סאני?'", pv.readBackHe.startsWith("הבנתי:") && pv.readBackHe.includes("ה-DJ של הלייבל") && pv.readBackHe.includes("ברוב") && pv.readBackHe.endsWith("לשמור את זה כידע של סאני?"));
    check("PREVIEW writes nothing", [w.table.rows.length, w.table.inserts], [0, 0]);
    const cm = (await commitKnowledgeCore(w.deps, ACTOR, CLINTON_ITEMS, pv.confirmationToken, U(7001))) as AnyRes & { ownerMessageHe: string; recorded: unknown[] };
    check("commit → LEARNED, 'למדתי' + what was recorded", [cm.status, cm.ownerMessageHe.startsWith("למדתי:"), cm.recorded.length], ["LEARNED", true, 2]);
    const recs = await w.records();
    ok("stored: provenance owner_via_sunny / mcp / client / token / attempt audit / LEARN_KNOWLEDGE (never Claude as the authority)", recs.every((r) => r.provenance.source === "owner_via_sunny" && r.provenance.channel === "mcp" && r.provenance.client_id === CLIENT && r.provenance.token_id === TOKEN_ID && r.provenance.attempt_audit_id === U(7001) && r.provenance.operation === "LEARN_KNOWLEDGE"));
    ok("ONE insert statement for the confirmed batch; only partner_owner_knowledge touched", w.table.inserts === 1 && [...w.table.tablesTouched].every((t) => t === OWNER_KNOWLEDGE_TABLE));
    const src = sources(recs);
    const q = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "owner_knowledge" }, src, OWNER_EXT);
    check("fresh read: owner_knowledge returns both, as OWNER_DECISION (not FACT), canonical=false", [q.status, q.items.length, q.items.every((i) => i.epistemic === "OWNER_DECISION" && i.fields.canonical === false)], ["OK", 2, true]);
    const viaDj = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "owner_knowledge", params: { entity: `dj:${C_CLEAN}` } }, src, OWNER_EXT);
    check("asking by the DJ key finds knowledge stored on the label-artist (same identity)", viaDj.items.length, 2);
    const enr = entityKnowledge(PARTNER_KNOWLEDGE_REGISTRY, { ...src, audience: OWNER_EXT }, `dj:${C_CLEAN}`);
    ok("partner_entity enrichment for the DJ includes 'מה סאני למד ממך' automatically (no MCP change per kind)", enr.some((s) => s.capability === "owner_knowledge" && s.items.length === 2));
    const rel = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "relations", params: { entity: `label-artist:${LA_CLEAN}` } }, src, OWNER_EXT);
    ok("relations: CANONICAL_RELATION (app link to the DJ record) + OWNER_CONFIRMED_RELATION edges; no manufactured DB link",
      rel.items.some((i) => i.fields.relationQuality === "CANONICAL_RELATION" && i.entity === `dj:${C_CLEAN}`) && rel.items.filter((i) => i.fields.relationQuality === "OWNER_CONFIRMED_RELATION").length === 2 && rel.items.every((i) => i.relationQuality !== "TEXT_MATCH"));
    const again = (await previewKnowledgeCore(w.deps, ACTOR, [CLINTON_ITEMS[0]])) as AnyRes;
    check("teaching it again → ALREADY_KNOWN (never re-asks / duplicates)", again.status, "ALREADY_KNOWN");
    const replay = (await commitKnowledgeCore(w.deps, ACTOR, CLINTON_ITEMS, pv.confirmationToken, U(7002))) as AnyRes;
    ok("replaying the same confirmation → refused (ALREADY_COMMITTED / ALREADY_KNOWN), no new rows", ["ALREADY_COMMITTED", "ALREADY_KNOWN"].includes(replay.status) && w.table.rows.length === 2);
  }

  section("C. Confirmation token: binding, expiry, one-time, STALE");
  {
    const w = world();
    const item = [{ kind: "RELEASE_PRIORITY", subject: `label-artist:${LA_SHALEV}`, fields: { priority: "NOT_URGENT" } }];
    const pv = (await previewKnowledgeCore(w.deps, ACTOR, item)) as AnyRes & { confirmationToken: string };
    check("preview by key", pv.status, "PREVIEW");
    const t = pv.confirmationToken;
    check("no token → TOKEN_INVALID", ((await commitKnowledgeCore(w.deps, ACTOR, item, undefined, U(1))) as AnyRes).status, "TOKEN_INVALID");
    check("another access token (same Owner) → TOKEN_INVALID", ((await commitKnowledgeCore(w.deps, { ...ACTOR, tokenId: U(99) }, item, t, U(1))) as AnyRes).status, "TOKEN_INVALID");
    check("another MCP client → TOKEN_INVALID", ((await commitKnowledgeCore(w.deps, { ...ACTOR, clientId: "rbmcp_" + "d".repeat(40) }, item, t, U(1))) as AnyRes).status, "TOKEN_INVALID");
    check("another user → TOKEN_INVALID", ((await commitKnowledgeCore(w.deps, { ...ACTOR, userId: U(98) }, item, t, U(1))) as AnyRes).status, "TOKEN_INVALID");
    check("tampered signature → TOKEN_INVALID", ((await commitKnowledgeCore(w.deps, ACTOR, item, t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA"), U(1))) as AnyRes).status, "TOKEN_INVALID");
    check("signed with another secret → TOKEN_INVALID", ((await commitKnowledgeCore({ ...w.deps, secret: "x".repeat(48) }, ACTOR, item, t, U(1))) as AnyRes).status, "TOKEN_INVALID");
    check("different payload (URGENT instead of NOT_URGENT) → STALE (re-preview)", ((await commitKnowledgeCore(w.deps, ACTOR, [{ ...item[0], fields: { priority: "URGENT" } }], t, U(1))) as AnyRes).status, "STALE");
    w.clock.now += TOKEN_TTL_MS + 1000;
    check("after 10 minutes → TOKEN_EXPIRED", ((await commitKnowledgeCore(w.deps, ACTOR, item, t, U(1))) as AnyRes).status, "TOKEN_EXPIRED");
    check("nothing was written by any refused commit", w.table.rows.length, 0);
    w.clock.now = NOW.getTime();
    const pv2 = (await previewKnowledgeCore(w.deps, ACTOR, item)) as AnyRes & { confirmationToken: string };
    // the slot changes between preview and commit (another session already stored a priority)
    await commitKnowledgeCore(w.deps, ACTOR, [{ ...item[0], fields: { priority: "URGENT" } }], ((await previewKnowledgeCore(w.deps, ACTOR, [{ ...item[0], fields: { priority: "URGENT" } }])) as AnyRes & { confirmationToken: string }).confirmationToken, U(2));
    check("relevant state changed since preview → STALE, nothing written", [((await commitKnowledgeCore(w.deps, ACTOR, item, pv2.confirmationToken, U(3))) as AnyRes).status, w.table.rows.length], ["STALE", 1]);
    w.live.owner = false;
    check("Owner re-check at preview + commit → NOT_AUTHORIZED", [((await previewKnowledgeCore(w.deps, ACTOR, item)) as AnyRes).status, ((await commitKnowledgeCore(w.deps, ACTOR, item, pv2.confirmationToken, U(4))) as AnyRes).status], ["NOT_AUTHORIZED", "NOT_AUTHORIZED"]);
    w.live.owner = true;
    const pv3 = (await previewKnowledgeCore(w.deps, ACTOR, item)) as AnyRes & { readBackHe: string; confirmationToken: string; items: Array<{ supersedesId: string | null }> };
    ok("a correction supersedes the slot's current row and the read-back says what it replaces", pv3.status === "PREVIEW" && !!pv3.items[0].supersedesId && pv3.readBackHe.includes("זה מחליף"));
    w.table.failNextInsert = { code: "23505", message: 'duplicate key value violates unique constraint "partner_owner_knowledge_slot_root_uk"' };
    check("a concurrent writer (DB unique) → STALE, never a second truth", ((await commitKnowledgeCore(w.deps, ACTOR, item, pv3.confirmationToken, U(5))) as AnyRes).status, "STALE");
    const pv4 = (await previewKnowledgeCore(w.deps, ACTOR, item)) as AnyRes & { confirmationToken: string };
    check("correction committed", ((await commitKnowledgeCore(w.deps, ACTOR, item, pv4.confirmationToken, U(6))) as AnyRes).status, "LEARNED");
    const recs = await w.records();
    check("history kept (2 rows), one active (the correction)", [recs.length, activeKnowledge(recs, "2026-09-24").length, activeKnowledge(recs, "2026-09-24")[0].value.priority], [2, 1, "NOT_URGENT"]);
    const wd = (await previewKnowledgeCore(w.deps, ACTOR, [{ ...item[0], operation: "WITHDRAW" }])) as AnyRes & { confirmationToken: string };
    check("WITHDRAW → committed; no active knowledge remains; history 3 rows", [((await commitKnowledgeCore(w.deps, ACTOR, [{ ...item[0], operation: "WITHDRAW" }], wd.confirmationToken, U(7))) as AnyRes).status, activeKnowledge(await w.records(), "2026-09-24").length, (await w.records()).length], ["LEARNED", 0, 3]);
    check("nothing to withdraw → NOTHING_TO_WITHDRAW", ((await previewKnowledgeCore(w.deps, ACTOR, [{ ...item[0], operation: "WITHDRAW" }])) as AnyRes).status, "NOTHING_TO_WITHDRAW");
  }

  section("D. Deterministic entity resolution — never a silent pick");
  {
    const w = world();
    const r1 = (await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "ENTITY_ALIAS", subject: "לקוח כפול", fields: { alias: "הכפול" } }])) as AnyRes & { candidates: unknown[] };
    check("two different entities with one name → NEEDS_CLARIFICATION with the candidates", [r1.status, r1.candidates.length >= 2], ["NEEDS_CLARIFICATION", true]);
    check("unknown name → NEEDS_CLARIFICATION (never invented)", ((await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "ENTITY_ALIAS", subject: "אמן שלא קיים 123", fields: { alias: "x" } }])) as AnyRes).status, "NEEDS_CLARIFICATION");
    check("a key that does not exist → INVALID", ((await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "ENTITY_ALIAS", subject: `label-artist:${U(999)}`, fields: { alias: "x" } }])) as AnyRes).status, "INVALID");
    check("an ambiguous OBJECT entity → NEEDS_CLARIFICATION", ((await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "ENTITY_RELATIONSHIP", subject: "קלינטון", fields: { relation: "WORKS_WITH", object: "לקוח כפול" } }])) as AnyRes).status, "NEEDS_CLARIFICATION");
    check("nothing written", w.table.rows.length, 0);
  }

  section("E. Owner-reported payment — knowledge only, NEVER a Finance transaction");
  {
    const w = world();
    const before = JSON.stringify(sources().finance);
    const item = [{ kind: "PAYMENT_REPORTED_BY_OWNER", subject: `project:${P(2)}`, fields: { direction: "RECEIVED", amount: "3,000", currency: "₪" } }];
    const pv = (await previewKnowledgeCore(w.deps, ACTOR, item)) as AnyRes & { items: Array<{ epistemic: string; value: Record<string, unknown>; conflicts: Array<{ code: string; severity: string }> }>; readBackHe: string; confirmationToken: string };
    check("preview: OWNER_REPORTED, amount normalized, canonical gap NOTE (not blocking)", [pv.status, pv.items[0].epistemic, pv.items[0].value.amount, pv.items[0].conflicts.map((c) => `${c.code}:${c.severity}`)], ["PREVIEW", "OWNER_REPORTED", 3000, ["NOT_RECORDED_IN_FINANCE:NOTE"]]);
    ok("read-back says it is not a Finance record", pv.readBackHe.includes("זה לא רישום בכספים"));
    await commitKnowledgeCore(w.deps, ACTOR, item, pv.confirmationToken, U(10));
    check("committed to partner_owner_knowledge ONLY (the store client can reach no other table); stored as OWNER_REPORTED", [w.table.rows.length, [...w.table.tablesTouched], (await w.records())[0].epistemic, before.length > 0], [1, [OWNER_KNOWLEDGE_TABLE], "OWNER_REPORTED", true]);
    w.live.financeMatch = true;
    const pv2 = (await previewKnowledgeCore(w.deps, ACTOR, [{ ...item[0], fields: { ...item[0].fields, amount: 500 } }])) as AnyRes & { items: Array<{ conflicts: Array<{ code: string }> }> };
    check("a matching Finance record → ALREADY_RECORDED_IN_FINANCE note", pv2.items[0].conflicts.map((c) => c.code), ["ALREADY_RECORDED_IN_FINANCE"]);
    check("a payment dated in the future → CONFLICT_WITH_LIVE", ((await previewKnowledgeCore(w.deps, ACTOR, [{ ...item[0], fields: { ...item[0].fields, date: "2026-12-01" } }])) as AnyRes).status, "CONFLICT_WITH_LIVE");
    ok("the owner-knowledge code imports no Finance writer / action executor / Owner Context store", ["lib/partner/owner-knowledge/propose.ts", "lib/partner/owner-knowledge/store.ts", "lib/partner/owner-knowledge/kinds.ts", "lib/partner/owner-knowledge/server.ts"].every((f) => !/finance\/execut|actions\/(execute|service|events)|context-persistence|\.rpc\(|\.upsert\(|\.from\([^)]*\)\s*\.(update|delete)\(/.test(read(f))));
  }

  section("F. Nothing generic can be written");
  {
    const w = world();
    check("kind NOTE → INVALID", ((await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "NOTE", subject: "קלינטון", fields: { text: "x" } }])) as AnyRes).status, "INVALID");
    check("a field the kind does not declare → INVALID", ((await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "ORGANIZATIONAL_ROLE", subject: "קלינטון", fields: { role: "LABEL_DJ", sql: "drop table" } }])) as AnyRes).status, "INVALID");
    check("an enum value outside the kind → INVALID", ((await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "ORGANIZATIONAL_ROLE", subject: "קלינטון", fields: { role: "ADMIN" } }])) as AnyRes).status, "INVALID");
    check("a table name as subject → not an entity (clarification, nothing written)", [((await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "ENTITY_ALIAS", subject: "partner_owner_context", fields: { alias: "x" } }])) as AnyRes).status, w.table.rows.length], ["NEEDS_CLARIFICATION", 0]);
    check("4 items → INVALID (max 3)", ((await previewKnowledgeCore(w.deps, ACTOR, [1, 2, 3, 4].map(() => CLINTON_ITEMS[0]))) as AnyRes).status, "INVALID");
    check("PROJECT_BLOCKER on a completed project → CONFLICT_WITH_LIVE", ((await previewKnowledgeCore(w.deps, ACTOR, [{ kind: "PROJECT_BLOCKER", subject: `project:${P(3)}`, fields: { reason: "WAITING_FOR_CLIENT" } }])) as AnyRes).status, "CONFLICT_WITH_LIVE");
    const shape = (args: unknown) => { const v = validateToolCall("partner_propose_knowledge", args); return v.ok ? "OK" : v.message.slice(0, 20); };
    check("MCP shape: table / sql / document / Owner Context row / key-value refused; typed item accepted", [
      shape({ stage: "preview", items: [{ kind: "ORGANIZATIONAL_ROLE", subject: "x" }], table: "partner_owner_context" }),
      shape({ stage: "preview", sql: "insert into x" }),
      shape({ stage: "preview", items: [{ kind: "ORGANIZATIONAL_ROLE", subject: "x", document: {} }] }),
      shape({ stage: "preview", items: [{ kind: "OWNER_CONTEXT", subject: "x" }] }),
      shape({ stage: "preview", items: [{ kind: "ORGANIZATIONAL_ROLE", subject: "x", fields: { nested: { a: 1 } } }] }),
      shape({ stage: "preview", items: [{ kind: "ORGANIZATIONAL_ROLE", subject: "קלינטון", fields: { role: "LABEL_DJ" } }] }),
    ].map((x) => x === "OK"), [false, false, false, false, false, true]);
    check("MCP shape: commit needs a pk1 token; preview refuses one", [shape({ stage: "commit", items: CLINTON_ITEMS }) === "OK", shape({ stage: "preview", items: CLINTON_ITEMS, confirmationToken: "pk1.x.y" }) === "OK"], [false, false]);
  }

  section("G. Knowledge MCP tool behind its switch (+ P1 unchanged)");
  {
    const cfg = (env: Record<string, string>) => { const r = readMcpConfig(env); if (!r.ok) throw new Error("config"); return r.config; };
    const P1_ENV = { ...BASE_ENV, PARTNER_MCP_ANSWER_ENABLED: "true", REDBLOODS_MCP_ONLY: "true" };
    const ALL_ENV = { ...P1_ENV, PARTNER_MCP_KNOWLEDGE_ENABLED: "true" };
    const p1 = cfg(P1_ENV), all = cfg(ALL_ENV);
    check("default config: knowledge OFF, propose_action OFF", [cfg(BASE_ENV).knowledgeEnabled, cfg(BASE_ENV).proposeActionEnabled], [false, false]);
    check("knowledge switch without MCP-only → stays OFF (never in the main app)", cfg({ ...BASE_ENV, PARTNER_MCP_KNOWLEDGE_ENABLED: "true" }).knowledgeEnabled, false);
    check("P1 (live connector config): advertised scope, metadata scopes and granted scope UNCHANGED", [advertisedScope(p1), protectedResourceMetadata(p1).scopes_supported, grantedScope(p1, null), grantedScope(p1, "partner:read"), grantedScope(p1, "partner:read partner:knowledge")],
      [ANSWER_SCOPE_STRING, ["partner:read", "partner:answer"], ANSWER_SCOPE_STRING, MCP_SCOPE, MCP_SCOPE]);
    ok("P1 step-up challenge still names partner:read partner:answer", insufficientScopeResponse(p1).headers["WWW-Authenticate"].includes(`scope="${ANSWER_SCOPE_STRING}"`));
    check("knowledge ON: canonical scope strings (read, answer, knowledge order)", [advertisedScope(all), grantedScope(all, null), grantedScope(all, "partner:read partner:knowledge"), grantedScope(all, "partner:knowledge partner:answer"), authorizationServerMetadata(all).scopes_supported],
      ["partner:read partner:answer partner:knowledge", "partner:read partner:answer partner:knowledge", "partner:read partner:knowledge", "partner:read partner:answer partner:knowledge", ["partner:read", "partner:answer", "partner:knowledge"]]);
    check("scope strings match the P2 DB CHECK set", [scopeString({ answer: false, knowledge: false }), scopeString({ answer: true, knowledge: false }), scopeString({ answer: false, knowledge: true }), scopeString({ answer: true, knowledge: true })],
      ["partner:read", "partner:read partner:answer", "partner:read partner:knowledge", "partner:read partner:answer partner:knowledge"]);
    ok("no partner:write / partner:propose_action scope anywhere in the connector", !/partner:write|partner:propose_action/.test(read("lib/integrations/partner-mcp/config.ts") + read("lib/integrations/partner-mcp/oauth.ts") + read("lib/integrations/partner-mcp/metadata.ts")));
    check("Sunny identity: resource_name / serverInfo title; protocol name unchanged", [protectedResourceMetadata(p1).resource_name, protectedResourceMetadata(cfg(BASE_ENV)).resource_name, SERVER_INFO.title, SERVER_INFO.name], ["Redbloods Sunny", "Redbloods Sunny (read-only)", "Redbloods Sunny", "redbloods-partner"]);
    ok("server instructions present Sunny (סאני) and keep the rules", SERVER_INSTRUCTIONS.includes("Sunny (סאני)") && SERVER_INSTRUCTIONS.includes("למדתי") && SERVER_INSTRUCTIONS.includes("Actions are approved only in the Redbloods dashboard"));
    check("tool names: no partner_propose_action tool exists (P3 not wired)", [TOOL_NAMES.includes("partner_propose_action" as never), buildToolDefinitions([], { answer: true, knowledge: true }).map((t) => t.name)], [false, ["partner_brief", "partner_resolve", "partner_entity", "partner_query", "partner_answer_question", "partner_propose_knowledge"]]);

    const w = world();
    const mk = (o: { env: Record<string, string>; scope: string; bind?: boolean; auditFail?: string }) => {
      const audit: AuditRow[] = [];
      let n = 0;
      const deps: McpDeps = {
        config: cfg(o.env), authenticate: async () => ({ ok: true as const, principal: { tokenId: TOKEN_ID, clientId: CLIENT, userId: OWNER_ID, scope: o.scope } }),
        gateway: { brief: async () => ({}), resolve: async () => ({}), entity: async () => ({}), query: async () => ({ status: "OK" }), capabilityIndex: () => [] },
        limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 500 }]),
        audit: async (r) => { if (o.auditFail && r.method === o.auditFail) throw new Error("audit down"); audit.push(r); }, auditRejected: async () => undefined, nowMs: () => Date.now(),
        answer: { limiter: new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 10 }]), newId: () => U(8500 + ++n), submit: async () => ({ status: "FAILED" }) },
        ...(o.bind === false ? {} : { knowledge: { limiter: new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 20 }]), newId: () => U(8000 + ++n),
          preview: async (i) => (await previewKnowledgeCore(w.deps, i.actor, i.items)) as unknown as Record<string, unknown>,
          commit: async (i) => (await commitKnowledgeCore(w.deps, i.actor, i.items, i.confirmationToken, i.attemptAuditId)) as unknown as Record<string, unknown> } }),
      };
      const rpc = async (method: string, params?: unknown) => {
        const res = await handleMcpHttp({ method: "POST", header: (h) => (h === "authorization" ? "Bearer t" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) }) }, deps);
        return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : null };
      };
      return { audit, rpc };
    };
    const names = async (m: ReturnType<typeof mk>) => ((await m.rpc("tools/list")).json.result.tools as Array<{ name: string }>).map((t) => t.name);
    const off = mk({ env: P1_ENV, scope: ANSWER_SCOPE_STRING, bind: false });
    check("switch OFF (production today): tools/list = the 5 P1 tools exactly", await names(off), ["partner_brief", "partner_resolve", "partner_entity", "partner_query", "partner_answer_question"]);
    const offCall = await off.rpc("tools/call", { name: "partner_propose_knowledge", arguments: { stage: "preview", items: CLINTON_ITEMS } });
    check("switch OFF: the knowledge tool does not exist (Unknown tool), nothing read or written", [offCall.json.error?.message, w.table.rows.length], ["Unknown tool", 0]);
    const noScope = mk({ env: ALL_ENV, scope: ANSWER_SCOPE_STRING });
    check("switch ON, token without partner:knowledge: not listed; a call → HTTP 403 insufficient_scope (step-up)", [(await names(noScope)).includes("partner_propose_knowledge"), (await noScope.rpc("tools/call", { name: "partner_propose_knowledge", arguments: { stage: "preview", items: CLINTON_ITEMS } })).status], [false, 403]);
    const on = mk({ env: ALL_ENV, scope: "partner:read partner:answer partner:knowledge" });
    ok("switch ON + scope: listed", (await names(on)).includes("partner_propose_knowledge"));
    ok("hasKnowledgeScope needs read too", hasKnowledgeScope("partner:read partner:knowledge") && !hasKnowledgeScope("partner:knowledge"));
    const pv = await on.rpc("tools/call", { name: "partner_propose_knowledge", arguments: { stage: "preview", items: CLINTON_ITEMS } });
    const pvBody = pv.json.result.structuredContent as { status: string; confirmationToken: string };
    check("preview through the adapter → PREVIEW; one audit row knowledge/preview (tool partner_propose_knowledge); nothing stored", [pvBody.status, on.audit.filter((a) => a.method.startsWith("knowledge/")).map((a) => `${a.method}:${a.tool}:${a.status}`), w.table.rows.length], ["PREVIEW", ["knowledge/preview:partner_propose_knowledge:OK"], 0]);
    const failing = mk({ env: ALL_ENV, scope: "partner:read partner:knowledge", auditFail: "knowledge/attempt" });
    const cf = await failing.rpc("tools/call", { name: "partner_propose_knowledge", arguments: { stage: "commit", items: CLINTON_ITEMS, confirmationToken: pvBody.confirmationToken } });
    check("attempt audit cannot be written → refused, NOTHING stored", [cf.json.error?.code, w.table.rows.length], [-32001, 0]);
    const cm = await on.rpc("tools/call", { name: "partner_propose_knowledge", arguments: { stage: "commit", items: CLINTON_ITEMS, confirmationToken: pvBody.confirmationToken } });
    const cmBody = cm.json.result.structuredContent as { status: string };
    const attempt = on.audit.find((a) => a.method === "knowledge/attempt")!;
    check("commit → LEARNED; audit: attempt row (app id) BEFORE the write, result row after", [cmBody.status, on.audit.filter((a) => a.method.startsWith("knowledge/")).map((a) => a.method)], ["LEARNED", ["knowledge/preview", "knowledge/attempt", "knowledge/commit"]]);
    ok("stored provenance references the ATTEMPT audit row id", (await w.records()).every((r) => r.provenance.attempt_audit_id === attempt.id));
    ok("audit rows carry no bodies (only a fingerprint)", on.audit.every((a) => !JSON.stringify(a).includes("קלינטון") && !JSON.stringify(a).includes("pk1.")));
  }

  section("H. MCP-only fetch guard");
  {
    const host = "db.example.supabase.co";
    const u = (p: string) => new URL(`https://${host}${p}`);
    check("knowledge INSERT only with the switch; never PATCH / DELETE / upsert; Owner Context rule unchanged", [
      isAllowedMcpOnlyFetch(u("/rest/v1/partner_owner_knowledge"), "POST", host),
      isAllowedMcpOnlyFetch(u("/rest/v1/partner_owner_knowledge"), "POST", host, { ownerKnowledgeAppend: true }),
      isAllowedMcpOnlyFetch(u("/rest/v1/partner_owner_knowledge"), "PATCH", host, { ownerKnowledgeAppend: true }),
      isAllowedMcpOnlyFetch(u("/rest/v1/partner_owner_knowledge"), "DELETE", host, { ownerKnowledgeAppend: true }),
      isAllowedMcpOnlyFetch(u("/rest/v1/partner_owner_knowledge?on_conflict=id"), "POST", host, { ownerKnowledgeAppend: true }),
      isAllowedMcpOnlyFetch(u("/rest/v1/partner_owner_context"), "POST", host, { ownerKnowledgeAppend: true }),
      isAllowedMcpOnlyFetch(u("/rest/v1/partner_owner_context"), "POST", host, { ownerContextAppend: true }),
      isAllowedMcpOnlyFetch(u("/rest/v1/transactions"), "POST", host, { ownerContextAppend: true, ownerKnowledgeAppend: true }),
    ], [false, true, false, false, false, false, true, false]);
    ok("instrumentation enables the knowledge append only from PARTNER_MCP_KNOWLEDGE_ENABLED", /ownerKnowledgeAppend: process\.env\.PARTNER_MCP_KNOWLEDGE_ENABLED === "true"/.test(read("instrumentation.ts")));
  }

  section("I. P3 — business-action proposal (preview only; nothing persisted or executed)");
  {
    const src = sources();
    const r = proposeActionPreviewCore(src, { actionType: "UPDATE_PROJECT_DEADLINE", project: `project:${P(2)}`, newDeadline: "2026-10-15" }) as AnyRes & { persisted: boolean; executed: boolean; summaryHe: string };
    check("deadline change → the EXISTING UPDATE_PROJECT_DEADLINE, PREVIEW_ONLY, persisted=false, executed=false", [r.status, r.actionType, r.persisted, r.executed, r.summaryHe.includes("15.10.2026")], ["PREVIEW_ONLY", "UPDATE_PROJECT_DEADLINE", false, false, true]);
    check("finance actions through Sunny → FINANCE_ACTIONS_DISABLED", [proposeActionPreviewCore(src, { actionType: "RECORD_PAID_EXPENSE", project: null, newDeadline: null }).status, proposeActionPreviewCore(src, { actionType: "RECORD_RECEIVED_INCOME", project: null, newDeadline: null }).status], ["FINANCE_ACTIONS_DISABLED", "FINANCE_ACTIONS_DISABLED"]);
    check("any other action → UNSUPPORTED_ACTION (no generic mutation)", proposeActionPreviewCore(src, { actionType: "DELETE_PROJECT", project: `project:${P(2)}`, newDeadline: "2026-10-15" }).status, "UNSUPPORTED_ACTION");
    check("completed project → CONFLICT_WITH_LIVE; past date → INVALID; ambiguous name → NEEDS_CLARIFICATION", [
      proposeActionPreviewCore(src, { actionType: "UPDATE_PROJECT_DEADLINE", project: `project:${P(3)}`, newDeadline: "2026-10-15" }).status,
      proposeActionPreviewCore(src, { actionType: "UPDATE_PROJECT_DEADLINE", project: `project:${P(2)}`, newDeadline: "2026-01-01" }).status,
      proposeActionPreviewCore(src, { actionType: "UPDATE_PROJECT_DEADLINE", project: "אבי", newDeadline: "2026-10-15" }).status,
    ], ["CONFLICT_WITH_LIVE", "INVALID", "NEEDS_CLARIFICATION"]);
    ok("the P3 core imports no writer / executor", !/actions\/(execute|service|events|decide)|\.rpc\(|\.insert\(|\.update\(|supabase/.test(read("lib/partner/sunny/action-proposal.ts")));
  }

  section("J. Provenance — backward compatible (owner_via_claude rows keep working; owner_via_sunny readable)");
  {
    const base = { channel: "mcp", client_id: CLIENT, token_id: TOKEN_ID, attempt_audit_id: U(1) };
    const e: string[] = [];
    check("existing P1 rows (owner_via_claude) still parse exactly", parseContextProvenance({ source: "owner_via_claude", ...base }, e), { source: "owner_via_claude", ...base });
    check("owner_via_sunny parses (same strict shape)", parseContextProvenance({ source: "owner_via_sunny", ...base }, e), { source: "owner_via_sunny", ...base });
    check("unknown source / extra key still refused", [parseContextProvenance({ source: "claude", ...base }, []), parseContextProvenance({ source: "owner_via_sunny", ...base, x: 1 }, [])], [null, null]);
    ok("P1 writes stay owner_via_claude in this release (two-phase switch after every service reads owner_via_sunny)", /source: "owner_via_claude"/.test(read("lib/partner/bridge/answer.ts")));
    ok("the register shows both connector provenances as 'via Sunny' in the UI", /owner_via_claude" \|\| c\.provenance\?\.source === "owner_via_sunny"/.test(read("lib/partner/integrity/register.ts")) && read("components/partner/PartnerIntegrityView.tsx").includes("דרך סאני"));
  }

  section("K. Read path while the store is OFF (production today) + improvement intelligence");
  {
    const src = sources();
    const q = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "owner_knowledge" }, src, OWNER_EXT);
    check("owner_knowledge with the store not enabled → UNKNOWN (never 'none')", [q.status, q.completeness, q.items.length], ["OK", "UNKNOWN", 0]);
    ok("entity enrichment skips it silently when not loaded", !entityKnowledge(PARTNER_KNOWLEDGE_REGISTRY, { ...src, audience: OWNER_EXT }, `label-artist:${LA_CLEAN}`).some((s) => s.capability === "owner_knowledge"));
    ok("read gating: PARTNER_OWNER_KNOWLEDGE_ENABLED must be exactly \"true\"", /process\.env\.PARTNER_OWNER_KNOWLEDGE_ENABLED === "true"/.test(read("lib/partner/company/read-context.ts")));
    const imp = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "improvement_signals" }, src, OWNER_EXT);
    ok("improvement_signals: analysis-only items, SYSTEM_GAP + PRODUCT_IMPROVEMENT_IDEA classes present", imp.status === "OK" && imp.items.every((i) => i.fields.analysisOnly === true) && imp.items.some((i) => i.fields.signal === "SYSTEM_GAP"));
    ok("Sunny never edits code: no fs / child_process / git in Sunny modules", ["lib/partner/knowledge/capabilities/sunny.ts", "lib/partner/sunny/action-proposal.ts", "lib/partner/owner-knowledge/propose.ts"].every((f) => !/node:fs|child_process|\bgit\b/.test(read(f))));
  }

  section("L. Sunny UX (Hebrew UI) — internal names intentionally unchanged");
  {
    const ui = ["PartnerIntegrityView", "PartnerActionCard", "PartnerOutcomeCard", "PartnerFinanceBrief"].map((c) => read(`components/partner/${c}.tsx`)).join("\n");
    ok("'סאני צריך ממך', 'מה סאני למד ממך', 'מה סאני מציע', 'מה סאני ביצע', heading 'סאני'", ["סאני צריך ממך", "מה סאני למד ממך", "מה סאני מציע", "מה סאני ביצע", ">סאני</h2>"].every((s) => ui.includes(s)));
    ok("consent page: Sunny heading + knowledge permission line", /Redbloods Sunny/.test(read("app/mcp-oauth/authorize/page.tsx")) && /data-consent-knowledge/.test(read("app/mcp-oauth/authorize/page.tsx")));
    ok("internal identifiers kept (tool names partner_*, lib/partner, table names)", TOOL_NAMES.every((t) => t.startsWith("partner_")) && fs.existsSync(path.join(ROOT, "lib/partner/gateway/server.ts")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
