/**
 * Tests — Sunny knowledge infrastructure (Owner-approved 2026-10-01): entity relationships with status + validity,
 * entity classifications, KNOWN_ENTITY (the controlled fallback identity), one BusinessArea list, provenance + confidence
 * (INFERRED never overrides), current vs historical, legacy rows, the MCP tool, and the readers.
 *
 * Run with:   npx tsx scripts/test-sunny-knowledge-infra.tsx
 *
 * NEVER touches production: the store runs over the in-memory mirror of the table (typed row shape = the same invariants
 * as the live CHECK / unique / FK set). The migration itself was applied and verified separately on 2026-10-01.
 */
import fs from "node:fs";
import path from "node:path";
import { KNOWLEDGE_KINDS, MAX_FIELDS, validateKnowledgeKinds } from "../lib/partner/owner-knowledge/kinds";
import { createOwnerKnowledgeStore, activeKnowledge, mapOwnerKnowledgeRow, OWNER_KNOWLEDGE_TABLE, type OwnerKnowledgeRecord, type OwnerKnowledgeTableClient } from "../lib/partner/owner-knowledge/store";
import { commitKnowledgeCore, createNonceGuard, previewKnowledgeCore, slugOf, type KnowledgeProposeDeps } from "../lib/partner/owner-knowledge/propose";
import { BUSINESS_AREAS, CLASSIFICATION_REGISTRY, RELATION_TYPES } from "../lib/partner/owner-knowledge/taxonomy";
import { temporalOf, provenanceOf, isAuthoritative } from "../lib/partner/owner-knowledge/provenance";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, KnowledgeItem } from "../lib/partner/knowledge/types";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildCompanyIntegrityRegister } from "../lib/partner/integrity/register";
import { KNOWLEDGE_KINDS_FOR_TOOL, validateToolCall, buildToolDefinitions } from "../lib/integrations/partner-mcp/tools";
import { NOW, U, LA_CLEAN, LA_SHALEV, LA_AVI, C_CLEAN, input, financeRaw } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}
      expected ${e}
      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (t: string) => console.log(`
${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

const OWNER_ID = "0f0f0f0f-0000-4000-8000-00000000a0a0";
const CLIENT = "rbmcp_" + "c".repeat(40);
const TOKEN_ID = "00000000-0000-4000-8000-00000000abcd";
const ACTOR = { userId: OWNER_ID, clientId: CLIENT, tokenId: TOKEN_ID };
const SECRET = "s".repeat(48);
const OWNER_EXT: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const IDS: GatewaySources["identities"] = { cleantone: { clientId: C_CLEAN, displayName: "DJ CLEANTONE", retiredKeys: [] } };

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
type AnyRes = Record<string, unknown> & { status: string };
const REG = PARTNER_KNOWLEDGE_REGISTRY;
let auditN = 20_000;
const SH = `label-artist:${LA_SHALEV}`, AVI = `label-artist:${LA_AVI}`;
const COMPANY = "company:REDBLOODS";

type World = ReturnType<typeof world>;
/** preview → (explicit confirmation) → commit with the SAME items. Returns both results. */
async function learn(w: World, items: unknown[]) {
  const pv = (await previewKnowledgeCore(w.deps, ACTOR, items)) as AnyRes & { confirmationToken?: string };
  if (pv.status !== "PREVIEW") return { pv, c: null as AnyRes | null };
  const c = (await commitKnowledgeCore(w.deps, ACTOR, items, pv.confirmationToken!, U(++auditN), "מאשר")) as AnyRes;
  return { pv, c };
}
const prev = async (w: World, items: unknown[]) => (await previewKnowledgeCore(w.deps, ACTOR, items)) as AnyRes & { errors?: string[]; messageHe?: string };
async function ask(w: World, params: Record<string, string>, mode?: string, cap = "owner_knowledge"): Promise<KnowledgeItem[]> {
  return queryKnowledgeCore(REG, { capability: cap, ...(mode ? { mode } : {}), params }, sources(await w.records()), OWNER_EXT).items;
}
const subjOf = (i: KnowledgeItem) => String((i.fields as Record<string, unknown>).subjectKey);
const F = (i: KnowledgeItem) => i.fields as Record<string, any>;
const declare = (name: string, extra: Record<string, string | number> = {}) => ({ kind: "KNOWN_ENTITY", subject: name, fields: { displayName: name, ...extra } });
const rel = (subject: string, relation: string, object: string, extra: Record<string, string | number> = {}) => ({ kind: "ENTITY_RELATIONSHIP", subject, fields: { relation, object, ...extra } });
const wide = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${String.fromCharCode(97 + i)}`, "v"]));

async function main() {
  section("A. Registry — typed, bounded, one BusinessArea list, tool parity");
  check("registry is valid", validateKnowledgeKinds(), []);
  const kinds = KNOWLEDGE_KINDS.map((k) => k.kind);
  ok("ENTITY_CLASSIFICATION + KNOWN_ENTITY exist; still no generic note kind", kinds.includes("ENTITY_CLASSIFICATION") && kinds.includes("KNOWN_ENTITY") && !kinds.some((k) => /NOTE|MEMO|FREE|GENERIC/.test(k)));
  check("the MCP tool's kind enum = the registry", [...KNOWLEDGE_KINDS_FOR_TOOL].sort(), [...kinds].sort());
  const sqlText = read("scripts/sql/2026-10-01-knowledge-infra-CANDIDATE.sql");
  const newKind = sqlText.match(/new_kind constant text := \$d\$([^$]*)\$d\$/)?.[1] ?? "";
  check("the 2026-10-01 kind CHECK = the registry minus the P2 decision / learning kinds (applied 2026-10-02)", (newKind.match(/'([A-Z_]+)'::text/g) ?? []).map((x) => x.replace(/'|::text/g, "")).sort(), kinds.filter((k) => k !== "BUSINESS_DECISION" && k !== "BUSINESS_LEARNING").sort());
  check("the 10 business areas, SOCIAL included", [...BUSINESS_AREAS], ["PROJECTS", "SHOWS", "FINANCE", "RELEASES", "TEAM", "CLIENTS", "SOCIAL", "MARKETING", "CONTENT", "OPERATIONS"]);
  const areaOf = (k: string) => { const f = KNOWLEDGE_KINDS.find((x) => x.kind === k)!.fields.area; return f.type === "enum" ? f.values : []; };
  check("PROCESS_FRICTION and WORKING_POLICY_CANDIDATE use the ONE area list (same reference)", [areaOf("PROCESS_FRICTION") === BUSINESS_AREAS, areaOf("WORKING_POLICY_CANDIDATE") === BUSINESS_AREAS], [true, true]);
  ok("no second inline area enum is left in the kind registry", !/"PROJECTS", "SHOWS", "FINANCE"/.test(read("lib/partner/owner-knowledge/kinds.ts")));
  ok("every relation type of the Owner's list exists, legacy ones too", ["OWNER_OF", "FOUNDER_OF", "LABEL_ARTIST_OF", "WORKS_WITH", "PRODUCER_FOR", "MANAGES", "COLLABORATES_WITH", "PARTICIPATES_IN_SHOWS", "REPRESENTS"].every((r) => (RELATION_TYPES as readonly string[]).includes(r)));
  ok("the MCP tool accepts the wider field object and still rejects more than the cap",
    validateToolCall("partner_propose_knowledge", { stage: "preview", items: [{ kind: "ENTITY_RELATIONSHIP", subject: "x", fields: wide(MAX_FIELDS) }] }).ok
    && !validateToolCall("partner_propose_knowledge", { stage: "preview", items: [{ kind: "ENTITY_RELATIONSHIP", subject: "x", fields: wide(MAX_FIELDS + 1) }] }).ok);
  ok("tool definition lists the new kinds, relation types, SOCIAL and the conflict state", (() => { const d = JSON.stringify(buildToolDefinitions([], { knowledge: true })); return ["ENTITY_CLASSIFICATION", "KNOWN_ENTITY", "OWNER_OF", "LABEL_ARTIST_OF", "SOCIAL", "PROVENANCE_CONFLICT"].every((t) => d.includes(t)); })());

  section("B. NagashBeatz — ONE known identity, OWNER_OF / PRODUCER_FOR, no aliases, no variants");
  {
    const w = world();
    const items = [declare("NagashBeatz"), rel("NagashBeatz", "OWNER_OF", "הלייבל"), rel("NagashBeatz", "PRODUCER_FOR", "הלייבל")];
    const pv = (await prev(w, items)) as AnyRes & { items?: Array<{ subjectKey: string }> };
    check("a batch of KNOWN_ENTITY + two relationships previews (a relation may name an entity declared earlier in the SAME call)", [pv.status, pv.items?.map((i) => i.subjectKey)], ["PREVIEW", ["known:nagashbeatz", "known:nagashbeatz", "known:nagashbeatz"]]);
    const r = await learn(w, items);
    check("commit → LEARNED", r.c?.status, "LEARNED");
    const recs = await w.records();
    check("stored: 3 rows, no ENTITY_ALIAS, exactly one known identity", [recs.length, recs.filter((x) => x.kind === "ENTITY_ALIAS").length, [...new Set(recs.map((x) => x.subjectKey))]], [3, 0, ["known:nagashbeatz"]]);
    const owner = await ask(w, { relation: "OWNER_OF" });
    check("Q: who owns Redbloods? → known:nagashbeatz OWNER_OF the company, OWNER_STATEMENT / CONFIRMED, CURRENT, OWNER_DECISION",
      [owner.length, subjOf(owner[0]), F(owner[0]).value.object, F(owner[0]).provenance.sourceType, F(owner[0]).provenance.confidence, F(owner[0]).temporal, owner[0].epistemic], [1, "known:nagashbeatz", COMPANY, "OWNER_STATEMENT", "CONFIRMED", "CURRENT", "OWNER_DECISION"]);
    check("the same question by the entity's slug returns both relationships", (await ask(w, { known: "nagashbeatz" })).filter((i) => i.fields.kind === "ENTITY_RELATIONSHIP").length, 2);
    const edges = await ask(w, { known: "nagashbeatz" }, undefined, "relations");
    ok("the relations graph shows the edges of the known identity (CURRENT, OWNER_CONFIRMED)", edges.length === 2 && edges.every((e) => e.relationQuality === "OWNER_CONFIRMED" && F(e).temporal === "CURRENT"));
    check("the name resolves again to the SAME identity (case of the same name), never a second one", ((await prev(w, [rel("nagashBEATZ", "MANAGES", "הלייבל")])) as AnyRes & { items?: Array<{ subjectKey: string }> }).items?.[0].subjectKey, "known:nagashbeatz");
    check("a variant is refused as a separate identity (POSSIBLE_DUPLICATE_ENTITY)", ((await prev(w, [declare("Nagash")])).errors ?? []).some((e) => /POSSIBLE_DUPLICATE_ENTITY/.test(e)), true);
    check("a same-key different spelling is refused (ENTITY_KEY_COLLISION)", ((await prev(w, [declare("NAGASHBEATZ")])).errors ?? []).some((e) => /ENTITY_KEY_COLLISION/.test(e)), true);
    check("re-declaring the identical entity is ALREADY_KNOWN", (await prev(w, [declare("NagashBeatz")])).status, "ALREADY_KNOWN");
    check("subject and displayName must be the same name", ((await prev(w, [{ kind: "KNOWN_ENTITY", subject: "Venus", fields: { displayName: "Someone Else" } }])).errors ?? []).some((e) => /same canonical name/.test(e)), true);
    check("a name with no latin letters cannot be a known identity", ((await prev(w, [declare("נגש ביטס")])).errors ?? []).length > 0, true);
    check("a canonical entity always wins: DJ CLEANTONE is refused as a known identity", ((await prev(w, [declare("DJ CLEANTONE")])).errors ?? []).some((e) => /ENTITY_ALREADY_EXISTS/.test(e)), true);
    check("slugOf is deterministic", [slugOf("NagashBeatz"), slugOf(" nagash  beatz "), slugOf("ÀB-c!")], ["nagashbeatz", "nagash-beatz", "ab-c"]);
    check("a relation to a name nobody declared → NEEDS_CLARIFICATION (never invented)", (await prev(w, [rel("Zzyzx Unknown", "WORKS_WITH", "הלייבל")])).status, "NEEDS_CLARIFICATION");
  }

  section("C. Roster — LABEL_ARTIST_OF ACTIVE vs ENDED vs WORKS_WITH (history is never deleted)");
  {
    const w = world();
    check("Venus / Mengistu / Avraham Ayalew declared once", (await learn(w, [declare("Venus"), declare("Mengistu"), declare("Avraham Ayalew")])).c?.status, "LEARNED");
    const a = await learn(w, [rel(SH, "LABEL_ARTIST_OF", "הלייבל", { status: "ACTIVE" }), rel(AVI, "LABEL_ARTIST_OF", "הלייבל"), rel("Venus", "LABEL_ARTIST_OF", "הלייבל", { status: "ACTIVE", validFrom: "2024-01-01" })]);
    check("three label artists committed", a.c?.status, "LEARNED");
    const b = await learn(w, [rel("Mengistu", "WORKS_WITH", "הלייבל"), rel("Avraham Ayalew", "WORKS_WITH", "הלייבל")]);
    check("two people who work with the label committed", b.c?.status, "LEARNED");
    check("Venus: the relationship ENDS — asserted again with ENDED + validUntil (supersedes, nothing deleted)", (await learn(w, [rel("Venus", "LABEL_ARTIST_OF", "הלייבל", { status: "ENDED", validFrom: "2024-01-01", validUntil: "2026-03-01" })])).c?.status, "LEARNED");
    const roster = await ask(w, { relation: "LABEL_ARTIST_OF" });
    check("Q: who is on the roster NOW? → ACTIVE only (Shalev, Avi); Venus is not current", roster.map(subjOf).sort(), [SH, AVI].sort());
    const was = await ask(w, { relation: "LABEL_ARTIST_OF" }, "historical");
    check("Q: who WAS on the roster? → Venus (ENDED), kept as history", [was.length, subjOf(was[0]), F(was[0]).temporal, F(was[0]).validity.status, F(was[0]).validity.validUntil], [1, "known:venus", "HISTORICAL", "ENDED", "2026-03-01"]);
    const all = await ask(w, { relation: "LABEL_ARTIST_OF" }, "all");
    ok("mode all keeps the superseded ACTIVE row too (history is complete)", all.length === 4 && all.some((i) => F(i).temporal === "SUPERSEDED"));
    const works = await ask(w, { relation: "WORKS_WITH" });
    check("Q: label artist or only works with us? WORKS_WITH people are NOT in the roster", [works.length, works.some((i) => roster.map(subjOf).includes(subjOf(i)))], [2, false]);
    check("nothing was deleted: 5 relationships + Venus's end = 6 stored relationship rows", (await w.records()).filter((r) => r.kind === "ENTITY_RELATIONSHIP").length, 6);
    check("LABEL_ARTIST_OF must point at the company", ((await prev(w, [rel(SH, "LABEL_ARTIST_OF", AVI)])).errors ?? []).some((e) => /LABEL_ARTIST_OF points at the company/.test(e)), true);
    check("an entity cannot be related to itself", ((await prev(w, [rel(SH, "WORKS_WITH", SH)])).errors ?? []).some((e) => /itself/.test(e)), true);
    check("the same ended fact twice → ALREADY_KNOWN", (await prev(w, [rel("Venus", "LABEL_ARTIST_OF", "הלייבל", { status: "ENDED", validFrom: "2024-01-01", validUntil: "2026-03-01" })])).status, "ALREADY_KNOWN");
    const edgesV = await ask(w, { known: "venus" }, undefined, "relations");
    check("relations: Venus's ended edge is served as HISTORICAL", edgesV.map((e) => [F(e).temporal, e.freshness]), [["HISTORICAL", "HISTORICAL"]]);
    check("invalid relationship type is rejected with a clear error", ((await prev(w, [rel(SH, "BOSS_OF", "הלייבל")])).errors ?? []).some((e) => /relation: one of/.test(e)), true);
  }

  section("D. Classification — type + registered value, never free text");
  {
    const w = world();
    const r = await learn(w, [{ kind: "ENTITY_CLASSIFICATION", subject: `project:${U(101)}`, fields: { classificationType: "RELEASE_TYPE", value: "NEW_VERSION" } }, { kind: "ENTITY_CLASSIFICATION", subject: "הלייבל", fields: { classificationType: "CONTENT_SERIES", value: "RED_BARS" } }]);
    check("RELEASE_TYPE=NEW_VERSION and CONTENT_SERIES=RED_BARS committed", r.c?.status, "LEARNED");
    const c = await ask(w, { classification: "RELEASE_TYPE" });
    check("read back: type / value / current / provenance", [c.length, F(c[0]).value.value, F(c[0]).temporal, F(c[0]).provenance.sourceType], [1, "NEW_VERSION", "CURRENT", "OWNER_STATEMENT"]);
    check("a value of another type is rejected", ((await prev(w, [{ kind: "ENTITY_CLASSIFICATION", subject: "הלייבל", fields: { classificationType: "RELEASE_TYPE", value: "RED_BARS" } }])).errors ?? []).some((e) => /not a registered value of RELEASE_TYPE/.test(e)), true);
    check("an unknown classification type is rejected", (await prev(w, [{ kind: "ENTITY_CLASSIFICATION", subject: "הלייבל", fields: { classificationType: "MOOD", value: "SAD" } }])).status, "INVALID");
    check("free text is not a value", (await prev(w, [{ kind: "ENTITY_CLASSIFICATION", subject: "הלייבל", fields: { classificationType: "CONTENT_SERIES", value: "some new idea I just had" } }])).status, "INVALID");
    check("the five types exist with their registries", Object.keys(CLASSIFICATION_REGISTRY), ["RELEASE_TYPE", "PROJECT_TYPE", "CHANNEL_PURPOSE", "CONTENT_SERIES", "CATALOG_POSITION"]);
    await learn(w, [{ kind: "ENTITY_CLASSIFICATION", subject: `project:${U(101)}`, fields: { classificationType: "RELEASE_TYPE", value: "SINGLE" } }]);
    check("a changed classification supersedes (one current value per type); the old one stays as history", [(await ask(w, { classification: "RELEASE_TYPE" })).map((i) => F(i).value.value), (await ask(w, { classification: "RELEASE_TYPE" }, "all")).length], [["SINGLE"], 2]);
  }

  section("E. Business areas / policies — SOCIAL is a knowledge area only");
  {
    const w = world();
    const r = await learn(w, [{ kind: "WORKING_POLICY_CANDIDATE", subject: "הלייבל", fields: { area: "SOCIAL", policyHe: "סושיאל הוא עדיפות עסקית גבוהה כרגע", validFrom: "2026-09-01" } }, { kind: "PROCESS_FRICTION", subject: "הלייבל", fields: { area: "MARKETING", frictionHe: "אין שיטה קבועה לפרסום ריליסים" } }]);
    check("a SOCIAL policy and a MARKETING friction are accepted", r.c?.status, "LEARNED");
    const pol = await ask(w, { area: "SOCIAL" });
    check("Q: which policies are active in SOCIAL? → one, still only a CANDIDATE", [pol.length, pol[0].epistemic, F(pol[0]).value.validFrom], [1, "OWNER_POLICY_CANDIDATE", "2026-09-01"]);
    check("an unknown area is rejected", (await prev(w, [{ kind: "PROCESS_FRICTION", subject: "הלייבל", fields: { area: "GOSSIP", frictionHe: "x" } }])).status, "INVALID");
    await learn(w, [{ kind: "WORKING_POLICY_CANDIDATE", subject: "הלייבל", fields: { area: "SOCIAL", policyHe: "סושיאל הוא עדיפות עסקית גבוהה כרגע", status: "ENDED", validUntil: "2026-09-20" } }]);
    check("a policy that ended is history, not active", [(await ask(w, { area: "SOCIAL" })).length, (await ask(w, { area: "SOCIAL" }, "historical")).length], [0, 1]);
  }

  section("F. Provenance + confidence — INFERRED is never confirmed and never overrides");
  {
    const w = world();
    const own = await learn(w, [rel(SH, "WORKS_WITH", "הלייבל", { sourceType: "OWNER_STATEMENT" })]);
    check("OWNER_STATEMENT accepted (default confidence CONFIRMED)", [own.c?.status, provenanceOf((await w.records())[0].value).confidence], ["LEARNED", "CONFIRMED"]);
    check("SYSTEM_RECORD needs a sourceRef", ((await prev(w, [rel(AVI, "WORKS_WITH", "הלייבל", { sourceType: "SYSTEM_RECORD" })])).errors ?? []).some((e) => /sourceRef/.test(e)), true);
    const sys = await learn(w, [rel(AVI, "WORKS_WITH", "הלייבל", { sourceType: "SYSTEM_RECORD", sourceRef: "label_artists:" + LA_AVI, observedAt: "2026-09-24" })]);
    const ext = await learn(w, [{ kind: "ENTITY_CLASSIFICATION", subject: "הלייבל", fields: { classificationType: "CATALOG_POSITION", value: "CORE", sourceType: "EXTERNAL_SOURCE", sourceRef: "spotify profile", confidence: "MEDIUM" } }]);
    check("SYSTEM_RECORD (with ref) and EXTERNAL_SOURCE accepted; stored as provenance, never as an Owner decision", [sys.c?.status, ext.c?.status, (await w.records()).filter((r) => r.value.sourceType && r.value.sourceType !== "OWNER_STATEMENT").map((r) => r.epistemic)], ["LEARNED", "LEARNED", ["OWNER_REPORTED", "OWNER_REPORTED"]]);
    check("INFERRED can never be CONFIRMED", ((await prev(w, [rel("הלייבל", "MANAGES", SH, { sourceType: "INFERRED", confidence: "CONFIRMED" })])).errors ?? []).some((e) => /INFERRED item can never be CONFIRMED/.test(e)), true);
    const inf = await learn(w, [rel("הלייבל", "MANAGES", SH, { sourceType: "INFERRED", confidence: "MEDIUM" })]);
    const infItem = (await ask(w, { relation: "MANAGES" }))[0];
    check("an INFERRED item is stored and READ as a HYPOTHESIS with DERIVED relation quality, never an Owner decision", [inf.c?.status, infItem.epistemic, infItem.relationQuality, F(infItem).provenance.sourceType, F(infItem).provenance.confidence], ["LEARNED", "HYPOTHESIS", "DERIVED", "INFERRED", "MEDIUM"]);
    const before = (await w.records()).length;
    const clash = await prev(w, [rel(SH, "WORKS_WITH", "הלייבל", { sourceType: "INFERRED", confidence: "LOW", status: "ENDED" })]);
    check("INFERRED cannot overwrite an Owner statement → PROVENANCE_CONFLICT (explicit, nothing written)", [clash.status, (await w.records()).length === before], ["PROVENANCE_CONFLICT", true]);
    check("INFERRED cannot overwrite a SYSTEM_RECORD either", (await prev(w, [rel(AVI, "WORKS_WITH", "הלייבל", { sourceType: "INFERRED", status: "ENDED" })])).status, "PROVENANCE_CONFLICT");
    const owner2 = await learn(w, [rel("הלייבל", "MANAGES", SH, { sourceType: "OWNER_STATEMENT" })]);
    check("the Owner CAN replace an inference with his statement (becomes authoritative; history kept)", [owner2.c?.status, isAuthoritative((await w.records()).at(-1)!.value)], ["LEARNED", true]);
    await learn(w, [{ ...rel(SH, "WORKS_WITH", "הלייבל"), operation: "WITHDRAW" }]);
    check("after the Owner withdrew a fact an inference does not bring it back", (await prev(w, [rel(SH, "WORKS_WITH", "הלייבל", { sourceType: "INFERRED", confidence: "LOW" })])).status, "PROVENANCE_CONFLICT");
    check("legacy rows (no provenance field) read as OWNER_STATEMENT and are authoritative", [provenanceOf({}).sourceType, provenanceOf({}).explicit, isAuthoritative({})], ["OWNER_STATEMENT", false, true]);
  }

  section("G. Time-aware knowledge — status + validFrom / validUntil");
  {
    check("temporalOf: status wins; then the validity window", [temporalOf({}, "2026-09-24"), temporalOf({ status: "ENDED" }, "2026-09-24"), temporalOf({ status: "HISTORICAL" }, "2026-09-24"), temporalOf({ validFrom: "2026-10-01" }, "2026-09-24"), temporalOf({ validUntil: "2026-09-01" }, "2026-09-24"), temporalOf({ validFrom: "2026-01-01", validUntil: "2026-12-31" }, "2026-09-24")], ["CURRENT", "HISTORICAL", "HISTORICAL", "FUTURE", "HISTORICAL", "CURRENT"]);
    const w = world();
    await learn(w, [declare("Mengistu")]);
    await learn(w, [rel("Mengistu", "PRODUCER_FOR", "הלייבל", { validFrom: "2027-01-01" })]);
    check("a relationship that starts in the future is not current (but is readable)", [(await ask(w, { relation: "PRODUCER_FOR" })).length, (await ask(w, { relation: "PRODUCER_FOR" }, "all")).map((i) => F(i).temporal)], [0, ["FUTURE"]]);
    check("validUntil before validFrom is rejected", ((await prev(w, [rel("Mengistu", "COLLABORATES_WITH", "הלייבל", { validFrom: "2026-05-01", validUntil: "2026-04-01" })])).errors ?? []).some((e) => /validUntil/.test(e)), true);
    check("a bad date is rejected", (await prev(w, [rel("Mengistu", "COLLABORATES_WITH", "הלייבל", { validFrom: "2026-13-40" })])).status, "INVALID");
    await learn(w, [rel("Mengistu", "COLLABORATES_WITH", "הלייבל", { validUntil: "2026-09-01" })]);
    check("a relationship whose validity passed is HISTORICAL without any new write", [(await ask(w, { relation: "COLLABORATES_WITH" })).length, (await ask(w, { relation: "COLLABORATES_WITH" }, "historical")).length], [0, 1]);
    check("activeKnowledge excludes ended / future values (the one 'in use' rule for every reader)", activeKnowledge(await w.records(), "2026-09-24").filter((r) => r.kind === "ENTITY_RELATIONSHIP").length, 0);
  }

  section("H. Backward compatibility — knowledge stored before keeps working");
  {
    const w = world();
    const legacyItem = { kind: "ENTITY_RELATIONSHIP", subject: "קלינטון", fields: { relation: "PARTICIPATES_IN_SHOWS", object: "הלייבל", frequency: "MOST" } };
    const first = await learn(w, [legacyItem]);
    check("a legacy relationship still commits", first.c?.status, "LEARNED");
    const stored = (await w.records())[0];
    const legacyValue = { relation: "PARTICIPATES_IN_SHOWS", object: COMPANY, objectLabel: "Redbloods", frequency: "MOST" };
    const row = { id: stored.id, created_at: stored.createdAt, schema_version: "partner-owner-knowledge-v1", kind: stored.kind, subject_key: stored.subjectKey, identity_keys: stored.identityKeys, slot_key: stored.slotKey, value: legacyValue, epistemic: stored.epistemic, meaning_he: stored.meaningHe, operation: "ASSERT", supersedes_id: null, review_at: null, expires_at: null, provenance: stored.provenance, confirmation_id: stored.confirmationId, item_index: 0 };
    const parsed = mapOwnerKnowledgeRow(row);
    ok("a legacy row (no new fields) still parses", parsed !== null);
    const src = sources([parsed!]);
    const items = queryKnowledgeCore(REG, { capability: "owner_knowledge", params: {} }, src, OWNER_EXT).items;
    check("a legacy row reads as CURRENT, OWNER_STATEMENT (not explicit), epistemic unchanged", [items.length, F(items[0]).temporal, F(items[0]).provenance.sourceType, F(items[0]).provenance.stated, items[0].epistemic], [1, "CURRENT", "OWNER_STATEMENT", false, "OWNER_DECISION"]);
    check("a legacy row with the old kind param and modes still answers", [queryKnowledgeCore(REG, { capability: "owner_knowledge", mode: "all", params: { kind: "ENTITY_RELATIONSHIP" } }, src, OWNER_EXT).items.length, queryKnowledgeCore(REG, { capability: "owner_knowledge", mode: "all", params: { kind: "ENTITY_ALIAS" } }, src, OWNER_EXT).items.length], [1, 0]);
    check("re-asserting an identical legacy fact is ALREADY_KNOWN (defaults do not make it 'new')", (await prev(w, [legacyItem])).status, "ALREADY_KNOWN");
    check("legacy policy areas are still accepted", (await prev(world(), [{ kind: "WORKING_POLICY_CANDIDATE", subject: "הלייבל", fields: { area: "TEAM", policyHe: "מדיניות ישנה" } }])).status, "PREVIEW");
    const badKnown = { ...row, subject_key: "known:Bad_Slug", identity_keys: ["known:Bad_Slug"] };
    const goodKnown = { ...row, subject_key: "known:venus", identity_keys: ["known:venus"], slot_key: `ENTITY_RELATIONSHIP|known:venus|rel:WORKS_WITH:${COMPANY}` };
    check("only a well-formed known: key parses as a subject", [mapOwnerKnowledgeRow(badKnown) === null, mapOwnerKnowledgeRow(goodKnown) !== null], [true, true]);
  }

  section("I. Proposal → validation → storage → read → Sunny context (nothing proposable is unreadable)");
  {
    const w = world();
    const all = [declare("Zed Beats"), rel("Zed Beats", "FOUNDER_OF", "הלייבל"), { kind: "ENTITY_CLASSIFICATION", subject: "Zed Beats", fields: { classificationType: "CHANNEL_PURPOSE", value: "LABEL_MAIN" } }];
    const r = await learn(w, all);
    check("committed", r.c?.status, "LEARNED");
    const fresh = await createOwnerKnowledgeStore(w.table.client()).list();
    check("a brand-new read returns every row", fresh.status === "OK" && fresh.records.length, 3);
    check("owner_knowledge returns every stored row with its kind", (await ask(w, {}, "all")).map((i) => i.fields.kind).sort(), ["ENTITY_CLASSIFICATION", "ENTITY_RELATIONSHIP", "KNOWN_ENTITY"]);
    const cap = REG.all().find((c) => c.id === "owner_knowledge")!;
    ok("every kind the tool accepts has a reader path (kind param enum covers it)", kinds.every((k) => { const p = cap.params.kind; return p.kind === "enum" && p.values.includes(k); }));
    ok("every committed row is typed and none mutates canonical state", (await w.records()).every((x) => KNOWLEDGE_KINDS.some((k) => k.kind === x.kind && k.mutatesCanonicalState === false)));
    ok("the reader and the new modules write nothing and import no writer", ["lib/partner/knowledge/capabilities/sunny.ts", "lib/partner/owner-knowledge/taxonomy.ts", "lib/partner/owner-knowledge/provenance.ts"].every((f) => !/\.(insert|update|upsert|delete|rpc)\s*\(|lib\/writes\/|createOwnerKnowledgeStore/.test(read(f))));
    ok("the system contract names the model (KNOWLEDGE_MODEL rule) and the new learn kinds", /KNOWLEDGE_MODEL/.test(read("lib/partner/system/registry.ts")) && /"ENTITY_CLASSIFICATION", "KNOWN_ENTITY"[,\]]/.test(read("lib/partner/system/registry.ts")));
  }

  section("J. BUSINESS_DECISION / BUSINESS_LEARNING (P2 kinds, Owner-approved path only)");
  {
    const w = world();
    const dec = (extra: Record<string, string | number> = {}) => ({ kind: "BUSINESS_DECISION", subject: "Redbloods", fields: { area: "RELEASES", topic: "Release Day", decisionHe: "משחררים סינגלים ביום חמישי", rationaleHe: "יותר האזנות בסוף שבוע", reviewAt: "2027-01-01", ...extra } });
    const r1 = await learn(w, [dec()]);
    check("a decision previews and commits only after the Owner's approval words", [r1.pv.status, r1.c?.status], ["PREVIEW", "LEARNED"]);
    const recs = await w.records();
    check("slot = decision:<area>:<topic slug>; review_at column = value.reviewAt", [recs[0]?.slotKey.endsWith("decision:RELEASES:release-day"), recs[0]?.reviewAt], [true, "2027-01-01"]);
    ok("read-back says it is a decision and names the reason", String(r1.pv.readBackHe).includes("החלטה") && String(r1.pv.readBackHe).includes("כי"));
    const r2 = await learn(w, [dec({ decisionHe: "משחררים סינגלים ביום רביעי" })]);
    check("a newer decision on the same area + topic supersedes (history kept)", [r2.c?.status, (await w.records()).length], ["LEARNED", 2]);
    check("active owner_knowledge shows only the current decision", (await ask(w, { kind: "BUSINESS_DECISION" }, "active")).map((i) => F(i).value?.decisionHe ?? F(i).decisionHe ?? JSON.stringify(F(i))).length, 1);
    check("a decision with a future decidedOn is refused (BLOCKING)", (await prev(world(), [dec({ decidedOn: "2099-01-01" })])).status === "PREVIEW", false);
    check("a topic that is not representable is refused", (await prev(world(), [dec({ topic: "שבוע" })])).status, "INVALID");
    const lrn = (extra: Record<string, string | number> = {}) => ({ kind: "BUSINESS_LEARNING", subject: "Redbloods", fields: { area: "CONTENT", topic: "reels-length", statementHe: "רילס קצרים מ-20 שניות עובדים לנו טוב יותר", ...extra } });
    const r3 = await learn(world(), [lrn()]);
    check("an Owner-stated learning commits (OWNER_STATEMENT default)", r3.c?.status, "LEARNED");
    check("an INFERRED learning is refused — an insight never becomes a learning silently", (await prev(world(), [lrn({ sourceType: "INFERRED", confidence: "MEDIUM" })])).status, "INVALID");
    check("an EXTERNAL_SOURCE learning is refused", (await prev(world(), [lrn({ sourceType: "EXTERNAL_SOURCE" })])).status, "INVALID");
    check("a learning citing a Sunny insight needs SYSTEM_RECORD + sourceRef and still the Owner's approval", [(await prev(world(), [lrn({ sourceType: "SYSTEM_RECORD" })])).status, (await learn(world(), [lrn({ sourceType: "SYSTEM_RECORD", sourceRef: "insight:0f0f0f0f-0000-4000-8000-00000000a0a1" })])).c?.status], ["INVALID", "LEARNED"]);
    ok("no code path maps a Brain insight to BUSINESS_LEARNING (only the Owner-approved knowledge tool writes it)", !fs.existsSync(path.join(ROOT, "lib/partner/brain")) || fs.readdirSync(path.join(ROOT, "lib/partner/brain")).every((f) => !/BUSINESS_LEARNING|BUSINESS_DECISION/.test(read(`lib/partner/brain/${f}`))));
    ok("the legacy writer is not broadened: still ONE insert in the store", (read("lib/partner/owner-knowledge/store.ts").match(/\.insert\(/g) ?? []).length === 1);
  }
}

main().then(() => { console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1); });
