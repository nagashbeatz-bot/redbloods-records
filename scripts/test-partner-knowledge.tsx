/**
 * Tests — Redbloods Partner UNIFIED KNOWLEDGE GATEWAY (capability registry + partner_query + entity enrichment).
 *
 * Run with:   npx tsx scripts/test-partner-knowledge.tsx
 *
 * NEVER touches production. Sources are built by the REAL engines over the production-shaped integrity fixture
 * (computeCoo + Eyes, deriveFinanceView, buildPartnerMemory, buildPartnerCases, buildCompanyIntegrityRegister).
 * The automatic-propagation proof registers TEST-ONLY capabilities in the registry ONLY and drives them through the
 * REAL MCP adapter (handleMcpHttp) — no capability-specific MCP code exists.
 */
import fs from "node:fs";
import path from "node:path";
import { handleMcpHttp, type McpDeps } from "../lib/integrations/partner-mcp/mcp";
import { SlidingWindowLimiter } from "../lib/integrations/partner-mcp/rate-limit";
import { guardOutput } from "../lib/integrations/partner-mcp/tools";
import type { AuditRow } from "../lib/integrations/partner-mcp/store";
import { readMcpConfig } from "../lib/integrations/partner-mcp/config";
import { buildPartnerKnowledgeRegistry, PARTNER_KNOWLEDGE_REGISTRY, PARTNER_KNOWLEDGE_CAPABILITIES } from "../lib/partner/knowledge/catalog";
import { createKnowledgeRegistry, type KnowledgeRegistry } from "../lib/partner/knowledge/registry";
import { entityKnowledge, queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, KnowledgeCapability, KnowledgeRequest, QueryResponse } from "../lib/partner/knowledge/types";
import { getPartnerBriefCore } from "../lib/partner/gateway/brief";
import { getPartnerEntityCore } from "../lib/partner/gateway/entity";
import type { GatewayFinance, GatewaySources } from "../lib/partner/gateway/core";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { buildPartnerMemory, type MemorySources } from "../lib/partner/memory/core";
import { buildPartnerCases } from "../lib/partner/cases/engine";
import { buildCompanyIntegrityRegister } from "../lib/partner/integrity/register";
import { NOW, LA_AVI, LA_NAGASH, LA_SHALEV, U, state, input, ctx, financeRaw } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const OWNER_EXT: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER_EXT: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const INTERNAL: KnowledgeAudience = { channel: "INTERNAL", ownerAuthorized: true };

/** Full request sources over the fixture, built by the real engines. `contexts` = active Owner answers. */
type InputOpts = NonNullable<Parameters<typeof input>[0]>;
function sources(o: { contexts?: InputOpts["contexts"]; opts?: InputOpts } = {}): GatewaySources {
  const inp = input({ ...(o.opts ?? {}), contexts: o.contexts === undefined ? [] : o.contexts });
  const st = inp.state!;
  const raw = financeRaw();
  const view = deriveFinanceView(raw, NOW, []);
  const finance: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  const memSrc: MemorySources = { now: NOW, finance: { status: "OK", raw, view }, ownerContexts: { status: "OK", history: (o.contexts ?? []) as never }, actionEvents: { status: "OK", events: [] }, outcomes: { status: "OK", outcomes: [] } };
  return {
    now: NOW, state: { status: "OK", value: st }, finance: { status: "OK", value: finance }, memory: { status: "OK", value: buildPartnerMemory(memSrc) },
    cases: { status: "OK", value: buildPartnerCases({ state: st, today: st.todayIL }) }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] },
    integrity: { status: "OK", value: buildCompanyIntegrityRegister(inp) }, identities: { cleantone: null },
  };
}
const q = (reg: KnowledgeRegistry, req: KnowledgeRequest, src: GatewaySources, a: KnowledgeAudience = OWNER_EXT): QueryResponse => queryKnowledgeCore(reg, req, src, a);

// ── test-only capabilities (registered ONLY in a test registry) ──
const probeRows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, n: i }));
const testProbe: KnowledgeCapability = {
  id: "test_probe", domain: "COMPANY", titleHe: "בדיקה", descriptionForModel: "TEST-ONLY capability used to prove automatic propagation.", examplesHe: ["בדיקה"],
  modes: { list: { descriptionForModel: "rows" }, one: { descriptionForModel: "one row" } }, defaultMode: "list",
  params: { kind: { kind: "enum", values: ["a", "b"], descriptionForModel: "kind" }, note: { kind: "text", maxLength: 40, descriptionForModel: "note" } },
  paging: { defaultLimit: 3, maxLimit: 5 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE"],
  read: (_src, qq) => ({
    items: probeRows.map((r) => ({ id: r.id, entity: null, label: { text: `row ${r.n}${qq.params.note ? ` ${qq.params.note}` : ""}`, trust: "RECORD" as const }, epistemic: r.n % 2 ? "OWNER_DECISION" as const : "UNKNOWN" as const, freshness: "HISTORICAL" as const, source: "PROJECTS" as const, relationQuality: "TEXT_MATCH" as const, fields: { n: r.n } })),
    summary: [], completeness: "PARTIAL", coverage: [{ text: "probe coverage", trust: "PARTNER" }], missing: [],
  }),
};
const testInternal: KnowledgeCapability = { ...testProbe, id: "test_internal", access: { externalRead: false, ownerOnly: false, sensitivity: "STANDARD" } };
const testOwnerOnly: KnowledgeCapability = { ...testProbe, id: "test_owner_only", access: { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } };
const testHuge: KnowledgeCapability = { ...testProbe, id: "test_huge", paging: { defaultLimit: 50, maxLimit: 50 },
  read: () => ({ items: Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, entity: null, label: { text: "x".repeat(250), trust: "RECORD" as const }, epistemic: "FACT" as const, freshness: "LIVE" as const, source: "PROJECTS" as const, fields: { blob: { text: "y".repeat(280), trust: "RECORD" } } })), summary: [], completeness: "COMPLETE", coverage: [], missing: [] }) };
const TEST_REG = buildPartnerKnowledgeRegistry([testProbe, testInternal, testOwnerOnly, testHuge]);

function mcpDeps(reg: KnowledgeRegistry, audience: KnowledgeAudience, src: GatewaySources, audit: AuditRow[], maxResultChars?: number): McpDeps {
  const cfg = readMcpConfig({ PARTNER_MCP_ENABLED: "true", PARTNER_MCP_BASE_URL: "https://partner-staging.example.com", PARTNER_MCP_SECRET: "x".repeat(40) });
  if (!cfg.ok) throw new Error("config");
  const index = () => reg.describe(audience).map((c) => ({ id: c.id, title: c.title, description: c.description, modes: Object.keys(c.modes), params: Object.keys(c.params) }));
  return {
    config: { ...cfg.config, ...(maxResultChars ? { maxResultChars } : {}) },
    authenticate: async () => ({ ok: true as const, principal: { tokenId: "00000000-0000-4000-8000-00000000abcd", clientId: "c", userId: "00000000-0000-4000-8000-00000000a0a0", scope: "partner:read" } }),
    gateway: {
      brief: async () => getPartnerBriefCore(src) as unknown as Record<string, unknown>,
      resolve: async () => ({ status: "NOT_FOUND" }),
      entity: async (k) => getPartnerEntityCore(k, { ...src, audience, entityKnowledge: (key) => entityKnowledge(reg, { ...src, audience }, key) }) as unknown as Record<string, unknown>,
      query: async (a) => queryKnowledgeCore(reg, a, src, audience) as unknown as Record<string, unknown>,
      capabilityIndex: index,
    },
    limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 500 }]), audit: async (r) => { audit.push(r); }, auditRejected: async () => undefined, nowMs: () => Date.now(),
  };
}
async function rpc(deps: McpDeps, method: string, params?: unknown) {
  const res = await handleMcpHttp({ method: "POST", header: (n) => (n === "authorization" ? "Bearer t" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) }) }, deps);
  return JSON.parse(res.body!);
}
const call = async (deps: McpDeps, args: Record<string, unknown>) => (await rpc(deps, "tools/call", { name: "partner_query", arguments: args })).result;

void (async () => {
  const src = sources();

  console.log("\n1. registry = explicit allowlist, validated at build time");
  {
    ok("production registry builds (every capability valid)", PARTNER_KNOWLEDGE_REGISTRY.all().length === PARTNER_KNOWLEDGE_CAPABILITIES.length + 1);
    const threw = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
    ok("duplicate id refused", threw(() => createKnowledgeRegistry([testProbe, testProbe])));
    ok("bad id refused (module-path shape)", threw(() => createKnowledgeRegistry([{ ...testProbe, id: "../lib/supabase" }])));
    ok("entityScope must point at an entityKey param", threw(() => createKnowledgeRegistry([{ ...testProbe, id: "bad_scope", entityScope: { types: ["project"], param: "kind", mode: "list", limit: 3 } }])));
    ok("paging above the global max refused", threw(() => createKnowledgeRegistry([{ ...testProbe, id: "bad_paging", paging: { defaultLimit: 1, maxLimit: 500 } }])));
    ok("every capability id also fits the audit method column (query/<id>, ^[a-z_/]{1,40}$)", PARTNER_KNOWLEDGE_REGISTRY.all().every((c) => /^[a-z_/]{1,40}$/.test(`query/${c.id}`)));
    ok("every capability has LLM-facing description + Hebrew examples + declared sources", PARTNER_KNOWLEDGE_CAPABILITIES.every((c) => c.descriptionForModel.length > 40 && c.examplesHe.length > 0 && Array.isArray(c.needs)));
  }

  console.log("\n2. automatic propagation — test-only capability through the REAL MCP adapter");
  {
    const audit: AuditRow[] = [];
    const deps = mcpDeps(TEST_REG, OWNER_EXT, src, audit);
    const tools = (await rpc(deps, "tools/list")).result.tools as Array<{ name: string; description: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }>;
    const qt = tools.find((t) => t.name === "partner_query")!;
    ok("1. Gateway discovers it: tools/list partner_query description lists test_probe (no MCP change)", qt.description.includes("test_probe") && !qt.description.includes("test_internal"));
    const cat = await call(deps, { capability: "catalog" });
    ok("1. …and the catalog capability lists it", (cat.structuredContent.items as Array<{ id: string }>).some((i) => i.id === "test_probe") && !(cat.structuredContent.items as Array<{ id: string }>).some((i) => i.id === "test_internal"));
    const r = await call(deps, { capability: "test_probe" });
    check("2. generic MCP read returns it", [r.isError, r.structuredContent.status, r.structuredContent.capability.id, r.structuredContent.items.length], [false, "OK", "test_probe", 3]);
    const mcpSrc = ["mcp.ts", "tools.ts", "server.ts"].map((f) => fs.readFileSync(path.join(__dirname, "../lib/integrations/partner-mcp", f), "utf8")).join("\n");
    ok("3. MCP has no capability-specific code (no capability id in code, no import of any Partner domain module)", !/["'](test_probe|shows|owner_needs|finance_receivables|label_roster|integrity|projects)["']/.test(mcpSrc) && !/from ["'][^"']*partner\/(integrity|finance|knowledge|memory|cases|eyes|dossiers)/.test(mcpSrc));
    const internal = await call(deps, { capability: "test_internal" });
    check("4. externalRead=false → refused as unknown (indistinguishable from non-existent)", [internal.isError, internal.structuredContent.status], [true, "UNKNOWN_CAPABILITY"]);
    check("4. …but INTERNAL (Redbloods OS) may read it", q(TEST_REG, { capability: "test_internal" }, src, INTERNAL).status, "OK");
    const stranger = await call(mcpDeps(TEST_REG, STRANGER_EXT, src, []), { capability: "test_owner_only" });
    check("5. Owner-only capability refused without the Owner's authority", [stranger.isError, stranger.structuredContent.status], [true, "NOT_AUTHORIZED"]);
    check("5. …allowed with it", (await call(deps, { capability: "test_owner_only" })).structuredContent.status, "OK");
    const huge = await call(mcpDeps(TEST_REG, OWNER_EXT, src, [], 8_000), { capability: "test_huge", limit: 50 });
    ok("6. output budget applies (guard trims items, counts them, keeps capability / page / completeness)", !!huge.structuredContent.budgetGuard && huge.content[0].text.length <= 8_000 && huge.structuredContent.page && huge.structuredContent.capability.id === "test_huge");
    ok("6. record text is length-capped in items", (q(TEST_REG, { capability: "test_huge", limit: 1 }, src).items[0].label.text.length <= 301));
    const p1 = await call(deps, { capability: "test_probe", limit: 3 });
    const p2 = await call(deps, { capability: "test_probe", limit: 3, cursor: p1.structuredContent.page.nextCursor });
    const p3 = await call(deps, { capability: "test_probe", limit: 3, cursor: p2.structuredContent.page.nextCursor });
    check("7. pagination: 3 + 3 + 1, total 7, last page has no cursor", [p1.structuredContent.items.map((i: { id: string }) => i.id), p2.structuredContent.items.map((i: { id: string }) => i.id), p3.structuredContent.items.map((i: { id: string }) => i.id), p3.structuredContent.page.total, p3.structuredContent.page.nextCursor], [["r0", "r1", "r2"], ["r3", "r4", "r5"], ["r6"], 7, null]);
    const wrongCursor = await call(deps, { capability: "test_probe", limit: 3, params: { kind: "a" }, cursor: p1.structuredContent.page.nextCursor });
    check("7. a cursor is bound to the same capability + mode + params", wrongCursor.structuredContent.status, "INVALID_CURSOR");
    check("7. limit above the capability max refused", (await call(deps, { capability: "test_probe", limit: 6 })).structuredContent.status, "INVALID_REQUEST");
    const it = r.structuredContent.items[1];
    check("8/9. epistemic + freshness + source + relation quality survive MCP", [r.structuredContent.items[0].epistemic, it.epistemic, it.freshness, it.source, it.relationQuality, r.structuredContent.completeness, r.structuredContent.coverage[0].text], ["UNKNOWN", "OWNER_DECISION", "HISTORICAL", "PROJECTS", "TEXT_MATCH", "PARTIAL", "probe coverage"]);
    const unreg = await call(deps, { capability: "shows_admin" });
    check("10. unregistered capability id refused", [unreg.isError, unreg.structuredContent.status], [true, "UNKNOWN_CAPABILITY"]);
    const bad = await rpc(deps, "tools/call", { name: "partner_query", arguments: { capability: "../../lib/supabase" } });
    const fn = await rpc(deps, "tools/call", { name: "partner_query", arguments: { capability: "catalog", function: "readFinanceRaw" } });
    const sql = await call(deps, { capability: "test_probe", params: { note: "'; drop table projects; --" } });
    const unknownParam = await call(deps, { capability: "test_probe", params: { table: "projects" } });
    check("11. no module / function / table can be invoked: path refused, extra keys refused, SQL is only a text value, unknown params refused",
      [bad.error?.code, fn.error?.code, sql.structuredContent.status, sql.structuredContent.items[0].label.text.includes("drop table"), unknownParam.structuredContent.status], [-32602, -32602, "OK", true, "INVALID_REQUEST"]);
    const qa = audit.filter((a) => a.method.startsWith("query/"));
    ok("audit: one row per query, tool NULL + method query/<id> (fits the live CHECKs), fingerprint only", qa.length >= 10 && qa.every((a) => a.tool === null && /^[a-z_/]{1,40}$/.test(a.method) && (a.input_fingerprint === null || /^[0-9a-f]{64}$/.test(a.input_fingerprint)) && a.input_key === null));
    ok("audit: refusals recorded as REJECTED with the refusal category", qa.some((a) => a.status === "REJECTED" && a.error_category === "UNKNOWN_CAPABILITY") && qa.some((a) => a.status === "REJECTED" && a.error_category === "INVALID_CURSOR"));
    ok("16. every tool stays read-only (readOnlyHint, never destructive)", tools.length === 4 && tools.every((t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
  }

  console.log("\n3. current Integrity questions reachable (no integrity-specific MCP code)");
  {
    const deps = mcpDeps(PARTNER_KNOWLEDGE_REGISTRY, OWNER_EXT, src, []);
    const needs = (await call(deps, { capability: "owner_needs" })).structuredContent;
    const qs = needs.items.filter((i: { fields: { kind: string } }) => i.fields.kind === "OWNER_QUESTION");
    check("11. 'מה אתה צריך ממני?' → the surfaced integrity questions (max 2) + deferred count", [qs.length, qs.map((i: { entity: string }) => i.entity).sort(), needs.summary.find((s: { code: string }) => s.code === "DEFERRED_QUESTIONS").value], [2, [`label-artist:${LA_AVI}`, `label-artist:${LA_NAGASH}`].sort(), 1]);
    ok("questions are UNKNOWN (Partner does not know) and say where the Owner answers — never answerable via Claude", qs.every((i: { epistemic: string; fields: { whereToAnswer: { text: string } } }) => i.epistemic === "UNKNOWN" && i.fields.whereToAnswer.text.includes("לוח הבקרה")));
    const ent = (await rpc(deps, "tools/call", { name: "partner_entity", arguments: { key: `label-artist:${LA_AVI}` } })).result.structuredContent;
    const sec = ent.knowledge.find((k: { capability: string }) => k.capability === "integrity");
    ok("'מה עם אבי?' → partner_entity knows the unresolved question (openQuestions + integrity knowledge section)", ent.openQuestions.some((x: { questionType: string }) => x.questionType === "INTEGRITY_LABEL_PROJECT_CLASSIFICATION") && sec?.items.some((i: { fields: { kind?: string } }) => i.fields.kind === "OWNER_QUESTION_OPEN"));
    const brief = (await rpc(deps, "tools/call", { name: "partner_brief", arguments: {} })).result.structuredContent;
    ok("13. partner_brief shows the Owner questions with a drillDown to partner_query owner_needs", brief.items.some((i: { category: string; source: string; drillDown: { tool: string; args: { capability: string } } | null }) => i.category === "OWNER_DECISION_NEEDED" && i.source === "INTEGRITY" && i.drillDown?.tool === "partner_query" && i.drillDown.args.capability === "owner_needs"));
  }

  console.log("\n4. after the Owner answers (dashboard) → Claude sees it with NO MCP change");
  {
    const s0 = sources();
    const qAvi = (s0.integrity as { value: { questions: Array<{ subject: { id: string }; questionId: string; caseId: string; fingerprint: string }> } }).value.questions.find((x) => x.subject.id === LA_AVI)!;
    const s1 = sources({ contexts: [ctx(qAvi.questionId, qAvi.caseId, "INTEGRITY_LABEL_PROJECT_CLASSIFICATION", "label-artist", LA_AVI, "LABEL_SONGS", qAvi.fingerprint, U(1501))] });
    const deps = mcpDeps(PARTNER_KNOWLEDGE_REGISTRY, OWNER_EXT, s1, []);
    const needs = (await call(deps, { capability: "owner_needs" })).structuredContent;
    ok("the answered question disappears; the deferred one moves up", !needs.items.some((i: { entity: string }) => i.entity === `label-artist:${LA_AVI}`) && needs.items.filter((i: { fields: { kind: string } }) => i.fields.kind === "OWNER_QUESTION").length === 2);
    const f = (await call(deps, { capability: "integrity", params: { entity: `label-artist:${LA_AVI}` } })).structuredContent.items.find((i: { fields: { type?: string } }) => i.fields.type === "LABEL_PROJECT_CLASSIFICATION_MISMATCH");
    check("9. the decision is OWNER_DECISION (never FACT), with the Owner's wording", [f.epistemic, f.fields.stance, f.fields.ownerDecision.epistemic, f.fields.ownerDecision.answer.text], ["OWNER_DECISION", "OWNER_DECIDED", "OWNER_DECISION", "הפרויקטים האלה הם עבודת לייבל"]);
    const roster = (await call(deps, { capability: "label_roster" })).structuredContent.items.find((i: { id: string }) => i.id === LA_AVI);
    ok("label roster carries the Owner decision for the artist", roster.fields.projectClassification.epistemic === "OWNER_DECISION");
    const od = (await call(deps, { capability: "owner_decisions" })).structuredContent.items;
    ok("owner_decisions lists it as OWNER_DECISION, with Partner's interpretation", od.some((i: { epistemic: string; label: { text: string } }) => i.epistemic === "OWNER_DECISION" && i.label.text.includes("עבודת לייבל")));
  }

  console.log("\n5. Shows as a broad collection query");
  {
    const deps = mcpDeps(PARTNER_KNOWLEDGE_REGISTRY, OWNER_EXT, src, []);
    const all = (await call(deps, { capability: "shows" })).structuredContent;
    check("12. 'יש הופעות?' → all shows + totals without any entity id", [all.status, all.page.total, all.summary.find((s: { code: string }) => s.code === "TOTAL").value], ["OK", 1, 1]);
    const up = (await call(deps, { capability: "shows", mode: "upcoming" })).structuredContent;
    const upFact = up.summary.find((s: { code: string }) => s.code === "UPCOMING_RECORDED");
    check("no future show rows → a FACT about the show records (not a calendar claim)", [up.items.length, upFact.value, upFact.epistemic, upFact.label.text], [0, 0, "FACT", "אין שורות הופעה עתידיות ברשומות ההופעות"]);
    const hist = (await call(deps, { capability: "shows", mode: "recent", limit: 5 })).structuredContent;
    ok("'היסטוריית הופעות' → bounded, newest first, with payment status + ID-linked artist / DJ", hist.items.length === 1 && hist.items[0].fields.paymentStatus === "שולם" && hist.items[0].fields.artist.link === "ID" && hist.page.limit === 5);
    ok("show price keeps its honesty (no currency column → DERIVED convention)", hist.items[0].fields.price.epistemic === "DERIVED");
    const byArtist = (await call(deps, { capability: "shows", params: { artist: `label-artist:${LA_SHALEV}` } })).structuredContent;
    ok("shows of a label artist via same-name client (TEXT_MATCH, never a hard link)", byArtist.items.length === 1 && byArtist.items[0].relationQuality === "TEXT_MATCH");
  }

  console.log("\n6. epistemic honesty across capabilities");
  {
    const reg = PARTNER_KNOWLEDGE_REGISTRY;
    const up = q(reg, { capability: "sessions", mode: "upcoming" }, src);
    ok("0 future session rows → PARTIAL + 'not an empty calendar'", up.completeness === "PARTIAL" && up.coverage.some((c) => c.text.includes("לא אומר שהיומן ריק")) && !JSON.stringify(up).includes("אין שום דבר ביומן"));
    const rel = q(reg, { capability: "releases" }, src);
    ok("missing release rows → PARTIAL + 'not no release planned'", rel.completeness === "PARTIAL" && rel.coverage.some((c) => c.text.includes("לא אומר שלא מתוכנן ריליס")));
    const ku = q(reg, { capability: "known_unknowns", limit: 40 }, src);
    ok("10. UNKNOWN stays UNKNOWN (future schedule gap listed as UNKNOWN)", ku.items.some((i) => i.id.startsWith("FUTURE_SCHEDULE_COVERAGE_GAP") && i.epistemic === "UNKNOWN"));
    const roster = q(reg, { capability: "label_roster" }, src);
    ok("no fake unified label balance (ledger without currency → UNKNOWN)", roster.items.every((i) => String(i.fields.balance).startsWith("UNKNOWN")) && roster.summary[0].epistemic === "OWNER_DECISION");
    const pr = q(reg, { capability: "projects", params: { about: `label-artist:${LA_AVI}` } }, src);
    ok("artist ↔ project links are TEXT_MATCH", pr.items.length > 0 && pr.items.every((i) => i.relationQuality === "TEXT_MATCH"));
    const rec = q(reg, { capability: "finance_receivables", mode: "all" }, src, STRANGER_EXT);
    check("finance is Owner-only", rec.status, "NOT_AUTHORIZED");
    const pos = q(reg, { capability: "finance_position" }, src);
    ok("finance position per currency (never merged) with Finance Brain semantics stated", pos.status === "OK" && pos.items.every((i) => typeof i.fields.currency === "string") && pos.coverage.some((c) => c.text.includes("never converted")));
  }

  console.log("\n7. every production capability: runs, bounded, no internals, fails closed");
  {
    const reg = PARTNER_KNOWLEDGE_REGISTRY;
    const empty: GatewaySources = { now: NOW, identities: { cleantone: null } };
    const down: GatewaySources = { now: NOW, identities: { cleantone: null }, state: { status: "UNAVAILABLE", detail: "x" }, finance: { status: "UNAVAILABLE", detail: "x" }, memory: { status: "UNAVAILABLE", detail: "x" }, cases: { status: "UNAVAILABLE", detail: "x" }, actions: { status: "UNAVAILABLE", detail: "x" }, outcomes: { status: "UNAVAILABLE", detail: "x" }, integrity: { status: "UNAVAILABLE", detail: "x" } };
    const outs = reg.all().flatMap((c) => Object.keys(c.modes).map((m) => ({ c, m, r: q(reg, { capability: c.id, mode: m }, src, INTERNAL) })));
    ok("every capability × mode answers OK over live-shaped data", outs.every((o) => o.r.status === "OK"));
    ok("no table / column / storage names or SQL in any capability output", outs.every((o) => !/project_business_type|label_artists|partner_owner_context|sound_engineer_work|red_films_productions|vendor_victor_payment|artist_balance_entries|supabase|select \*|from [a-z_]+ where/.test(JSON.stringify(o.r))));
    const downs = reg.all().filter((c) => c.needs.length).map((c) => q(reg, { capability: c.id }, down, INTERNAL));
    ok("a source that cannot be read → completeness UNKNOWN + missing[] (never an empty 'none')", downs.every((r) => r.completeness === "UNKNOWN" && r.missing.length > 0));
    ok("…also when a source was not loaded at all", reg.all().filter((c) => c.needs.length).every((c) => q(reg, { capability: c.id }, empty, INTERNAL).completeness === "UNKNOWN"));
    ok("every page ≤ its capability max", outs.every((o) => o.r.items.length <= o.c.paging.maxLimit));
  }

  console.log("\n8. entity enrichment is automatic + bounded");
  {
    const s = { ...src, audience: OWNER_EXT };
    const secs = entityKnowledge(PARTNER_KNOWLEDGE_REGISTRY, s, `label-artist:${LA_SHALEV}`);
    ok("label-artist entity gets integrity / projects / releases / shows sections from their entityScope only", secs.map((x) => x.capability).every((c) => ["integrity", "projects", "releases", "shows"].includes(c)) && secs.some((x) => x.capability === "shows"));
    ok("each section bounded by its entityScope.limit", secs.every((x) => x.items.length <= (PARTNER_KNOWLEDGE_REGISTRY.get(x.capability)!.entityScope!.limit)));
    const stranger = entityKnowledge(PARTNER_KNOWLEDGE_REGISTRY, { ...src, audience: STRANGER_EXT }, `client:${U(203)}`);
    ok("Owner-only capabilities never enrich an entity for a caller without Owner authority", !stranger.some((x) => x.capability === "proposals"));
    ok("no audience → most restrictive default", !entityKnowledge(PARTNER_KNOWLEDGE_REGISTRY, src, `client:${U(203)}`).some((x) => x.capability === "proposals"));
  }

  console.log("\n9. static guards");
  {
    const root = path.resolve(__dirname, "..");
    const dir = (d: string) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".ts")).map((f) => fs.readFileSync(path.join(root, d, f), "utf8")).join("\n");
    const kn = dir("lib/partner/knowledge") + dir("lib/partner/knowledge/capabilities");
    ok("17. knowledge layer never writes and never reaches the database directly", !/\.(insert|upsert|rpc)\(|\.update\(\{|\.delete\(\)|lib\/supabase|from\("|appendOwnerContext|context-store/.test(kn));
    ok("11. no dynamic import / eval / Function / require in the knowledge layer or MCP adapter", !/import\(|\beval\(|new Function|require\(/.test(kn + dir("lib/integrations/partner-mcp").replace(/await import\("@\/lib\/(supabase|partner\/gateway\/server|partner\/bridge\/server|supabase-server|roles)"\)/g, "")));
    ok("capability lookup is an exact Map lookup", /map\.has\(id\) \? map\.get\(id\)!/.test(fs.readFileSync(path.join(root, "lib/partner/knowledge/registry.ts"), "utf8")));
    const srv = fs.readFileSync(path.join(root, "lib/partner/gateway/server.ts"), "utf8");
    ok("the Gateway loads only the capability's declared sources, and refusals read nothing", /loadSources\(ctx, v\.value\.cap\.needs, audience\)/.test(srv) && /v\.ok \? await loadSources/.test(srv));
    const mcpServer = fs.readFileSync(path.join(root, "lib/integrations/partner-mcp/server.ts"), "utf8");
    ok("MCP binds partner_query to the Gateway only, as EXTERNAL with the Owner's grant", /query: async \(a\) => \(await queryPartnerKnowledge\(a, MCP_AUDIENCE\)\)/.test(mcpServer) && /MCP_AUDIENCE = \{ channel: "EXTERNAL", ownerAuthorized: true \}/.test(mcpServer));
    ok("18. no write / answer path anywhere in the knowledge layer or MCP (no Owner answer can be written from Claude)", !/answerIntegrityQuestion|answerFinanceQuestion|decideSuggestedAction|executeApprovedAction/.test(kn + dir("lib/integrations/partner-mcp")));
    ok("MCP audit tool type = the 3 read tools + the P1 answer tool only (matches the P1 audit CHECK; partner_query stays NULL)", /tool: "partner_brief" \| "partner_resolve" \| "partner_entity" \| "partner_answer_question" \| null;/.test(fs.readFileSync(path.join(root, "lib/integrations/partner-mcp/store.ts"), "utf8")));
    ok("no Google Calendar in the knowledge layer", !/googleapis|google-calendar|calendar\.events/.test(kn));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
