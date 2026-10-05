/**
 * Dashboard ↔ Sunny parity (Owner decision 2026-10-05, Phase A — data / source unification). The Owner's executive read
 * (GET /api/partner/executive) and the chat (the real MCP connector path) must serve the SAME truth: the same
 * BUSINESS_MOTION (greeting / todayItems / inbox / financial / learning), the same FINANCIAL_FORWARD and the same
 * needs_me, under the same owner action history and the same lifecycle. No network, no DB: the SAME company fixture the
 * motion contract is proven on (scripts/fixtures/motion-company.ts), the REAL connector adapter (handleMcpHttp), the
 * REAL internal act gate (handleInternalAct) and the REAL action service (planStatus) over a fake history store.
 * Run with:   npx tsx scripts/test-dashboard-sunny-parity.tsx
 */
import fs from "node:fs";
import path from "node:path";
import { src, U, TODAY, D, K, P_YAHALOM, P_MAOR, P_EIN, blocker, type Fx } from "./fixtures/motion-company";
import { handleMcpHttp, type McpDeps, type McpGateway } from "../lib/integrations/partner-mcp/mcp";
import { readMcpConfig } from "../lib/integrations/partner-mcp/config";
import { SlidingWindowLimiter } from "../lib/integrations/partner-mcp/rate-limit";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import { ACTION_HISTORY_REQUEST, actionHistoryItemsOf, deriveWithActionHistory, historyDerivationFor } from "../lib/partner/sunny/with-history";
import { assembleExecutive, EXECUTIVE_PARTS, executiveParity, readExecutiveParts, type ExecutivePart } from "../lib/partner/gateway/executive";
import { readOwnerActionHistory, DASHBOARD_ACT_CLIENT_ID } from "../lib/partner/act/owner-history";
import { handleInternalAct } from "../lib/partner/act/internal-handler";
import { buildNeedsMe } from "../lib/partner/needs-me/curate";
import { INTERNAL_AUTH_HEADER } from "../lib/partner/calendar/internal-auth";
import type { ActServiceDeps } from "../lib/partner/act/service";
import type { Plan } from "../lib/partner/act/types";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { parseExecutive, servedItems, indexByEntity, enrichmentFor, isCanonicalKey, openOfEntity, totalsHe, type ExecMotion, type ExecItem } from "../lib/dashboard-executive";
import { buildTimeline } from "../lib/dashboard-v2";
import { parseBoard } from "../components/dashboard-v2/DashboardV2";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 900)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const OWNER_ID = "owner-user-1";
const NOW = new Date(`${TODAY}T18:00:00Z`);
const SECRET = "s".repeat(40);
const INTERNAL = { channel: "INTERNAL" as const, ownerAuthorized: true };
const EXTERNAL = { channel: "EXTERNAL" as const, ownerAuthorized: true };
const MAIN_ENV = { PARTNER_ACT_ENABLED: "true", PARTNER_INTERNAL_ACT_SECRET: SECRET };
const CONNECTOR_ENV = { PARTNER_MCP_ENABLED: "true", PARTNER_MCP_BASE_URL: "https://c.example", PARTNER_MCP_SECRET: "m".repeat(64), REDBLOODS_MCP_ONLY: "true", PARTNER_MCP_KNOWLEDGE_ENABLED: "true", PARTNER_MCP_ACT_ENABLED: "true", PARTNER_MAIN_BASE_URL: "https://main.example", PARTNER_INTERNAL_ACT_SECRET: SECRET };

// ── the company: the motion fixture + linked / unlinked Owner updates + his "מחכה לבעלים" on יהלום (A1) ──
const N = (id: number, body: string, d: number, link?: string) => ({ id: U(id), body, at: `${D(d)}T10:00:00Z`, ...(link ? { link } : {}) });
const FX: Fx = {
  inbox: [N(80, "היום עם מאור היה סשן טוב אבל חייב להתקדם", -5, K(P_MAOR)), N(101, "דחוף למקססס את יהלום", 0), N(102, "לשנות את העטיפה של יהלום", 0), N(103, "לתקן התראות של סטיבן", 0), N(104, "צריך לחשוב על זה שוב", -1)],
  knowledge: [blocker(U(85), K(P_EIN), "שליו לא מצליח לסיים את הוורס השני", `${D(-7)}T13:17:00Z`),
    { ...blocker(U(87), K(P_YAHALOM), "כל השאר גמור; נשאר רק לסגור את ההפקה", `${D(-9)}T10:00:00Z`), value: { detail: "כל השאר גמור; נשאר רק לסגור את ההפקה", reason: "WAITING_FOR_OWNER" } }],
  extraSendLog: [{ id: U(75), projectId: P_MAOR, actionType: "received", contentType: "מיקס", recipientRole: "owner", recipientName: null, status: "pending_feedback", actionDate: D(-4), followupDate: null },
    { id: U(74), projectId: P_YAHALOM, actionType: "sent", contentType: "גרסה לאישור", recipientRole: "client", recipientName: null, status: "pending_feedback", actionDate: D(-100), followupDate: D(-95) }],
};
const SRC = (): GatewaySources => ({ ...src(FX), now: NOW } as GatewaySources);

// ── the owner action history: ONE executed planning move on יהלום after the note (moves the inbox lifecycle + learning) ──
const plan: Plan = {
  planId: "pl_" + "d".repeat(18), ownerId: OWNER_ID, clientId: "client-1", intentHe: "להזיז את הדדליין של יהלום",
  steps: [{ index: 0, actionId: "UPDATE_PROJECT_DEADLINE", actionVersion: 1, args: { project: K(P_YAHALOM), deadline: D(9) }, entities: [K(P_YAHALOM)], phase: "W1" as never, expectedFingerprint: "f".repeat(64), changes: [{ field: "deadline", before: D(6), after: D(9) }], dependsOn: [] }],
  riskClass: "LOW" as never, confirmation: "OWNER_APPROVAL" as never, effects: [], createdAt: `${D(0)}T11:00:00Z`, expiresAt: `${D(1)}T11:00:00Z`,
};
const historyCalls: Array<{ ownerId: string; q: unknown }> = [];
const actDeps = (o: { owner?: boolean; plans?: boolean } = {}): ActServiceDeps => ({
  nowMs: () => NOW.getTime(), isOwner: async (u: string) => (o.owner ?? true) && u === OWNER_ID,
  stores: { plans: o.plans === false ? {} : { history: async (ownerId: string, q: unknown) => { historyCalls.push({ ownerId, q }); return { items: ownerId === OWNER_ID ? [{ plan, executions: [{ stepIndex: 0, status: "APPLIED_AS_EXPECTED", outcome: { index: 0, actionId: "UPDATE_PROJECT_DEADLINE", status: "APPLIED_AS_EXPECTED", detail: "ok", replayed: false, at: `${D(0)}T12:00:00Z` } }], eventTypes: ["APPROVED"], executedAt: `${D(0)}T12:00:00Z`, approvalDetail: "OWNER_APPROVAL" }] : [], nextBefore: null }; } } },
} as unknown as ActServiceDeps);

// ── the CHAT: the real connector adapter, the gateway wired exactly as lib/integrations/partner-mcp/server.ts wires it ──
function connector(o: { act?: boolean; scope?: string; sources?: () => GatewaySources; d?: ActServiceDeps } = {}): McpDeps {
  const cfg = readMcpConfig(o.act === false ? { ...CONNECTOR_ENV, PARTNER_MCP_ACT_ENABLED: "false" } : CONNECTOR_ENV);
  if (!cfg.ok) throw new Error("connector config");
  const sources = o.sources ?? SRC;
  const gateway: McpGateway = {
    brief: async () => ({}), resolve: async () => ({}), entity: async () => ({}),
    query: async (a) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, a, sources(), EXTERNAL) as unknown as Record<string, unknown>,
    capabilityIndex: () => [],
    withActionHistory: (kind, payload, history, nowMs) => deriveWithActionHistory(kind, payload, history, nowMs),
    historyDerivationFor, actionHistoryRequest: ACTION_HISTORY_REQUEST, actionHistoryItemsOf,
  };
  const d = o.d ?? actDeps();
  return {
    config: { ...cfg.config, maxResultChars: 1_000_000 }, authenticate: async () => ({ ok: true, principal: { tokenId: "t1", clientId: "client-1", userId: OWNER_ID, scope: o.scope ?? "partner:read partner:knowledge partner:act" } }),
    gateway, limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 1000 }]), audit: async () => undefined, auditRejected: async () => undefined, nowMs: () => NOW.getTime(),
    // the relay → MAIN's REAL internal act gate (secret, op / key allowlists) → the REAL action service
    ...(o.act === false ? {} : { act: { limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 1000 }]), call: async (op: string, input: Record<string, unknown>, caller: { userId: string; clientId: string }) =>
      (await handleInternalAct({ header: (n) => (n === INTERNAL_AUTH_HEADER ? SECRET : null), bodyText: async () => JSON.stringify({ op, ownerId: caller.userId, clientId: caller.clientId, input }) }, MAIN_ENV, async () => d)).body as Record<string, unknown> } }),
  } as McpDeps;
}
async function chat(deps: McpDeps, capability: string, mode: string): Promise<Record<string, unknown>> {
  const out = await handleMcpHttp({ method: "POST", header: (n) => (n === "authorization" ? "Bearer x" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "partner_query", arguments: { capability, mode, limit: 50 } } }) }, deps);
  const j = JSON.parse(out.body ?? "{}");
  return j.result?.structuredContent ?? { error: j.error ?? j };
}

// ── the DASHBOARD: the executive read over the SAME sources, MAIN's own history read ──
const dashQuery = (sources: () => GatewaySources, audience: typeof INTERNAL | typeof EXTERNAL = INTERNAL) => async (part: ExecutivePart) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { ...EXECUTIVE_PARTS[part], limit: 50 }, sources(), audience) as unknown as Record<string, unknown>;
async function dashboard(o: { env?: Record<string, string>; d?: ActServiceDeps; ownerId?: string | null; sources?: () => GatewaySources; audience?: typeof INTERNAL | typeof EXTERNAL } = {}) {
  const history = await readOwnerActionHistory(o.ownerId === undefined ? OWNER_ID : o.ownerId, o.env ?? MAIN_ENV, async () => o.d ?? actDeps());
  return readExecutiveParts(history, dashQuery(o.sources ?? SRC, o.audience ?? INTERNAL), NOW);
}

type Sum = Array<{ code: string; value: unknown }>;
const fact = (p: Record<string, unknown>, c: string) => ((p.summary ?? []) as Sum).find((x) => x.code === c)?.value as Record<string, unknown> | undefined;
const motionOf = (p: Record<string, unknown>) => fact(p, "MOTION") as Record<string, unknown> & { greeting: Array<{ key: string; level: string; he: string; move: unknown; learning?: unknown }>; todayItems: Array<{ key: string; level: string; he: string; move: unknown; learning?: unknown; codes: string[]; entity: string | null; entities: string[] }>; inbox: { lineHe: string | null; counts: Record<string, number>; needsOwner: number; entries: Array<{ lifecycle: { itemId: string; state: string } }> }; financial: Record<string, unknown> | null; learning: { status: string; changed: number }; answerHe: string; all?: unknown };
const strip = (p: Record<string, unknown>) => { const { asOf: _a, query: _q, ...rest } = p; void _a; void _q; return rest; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  section("1. SAME MINUTE, SAME OWNER: chat partner_query ≡ /api/partner/executive (the full payloads)");
  const deps = connector();
  const [cMotion, cForward, cNeeds] = [await chat(deps, "coo", "motion"), await chat(deps, "coo", "forward"), await chat(deps, "needs_me", "board")];
  const dash = await dashboard();
  ok("1a. every part was read (status OK on both sides)", [cMotion, cForward, cNeeds, dash.motion, dash.forward, dash.needsMe].every((p) => p.status === "OK"), [cMotion.status, cForward.status, cNeeds.status, dash.motion.status, dash.forward.status, dash.needsMe.status]);
  const cm = motionOf(cMotion), dm = motionOf(dash.motion);
  ok("1b. greeting identical (keys, levels, text, moves, learning)", same(cm.greeting, dm.greeting) && cm.greeting.length > 0, { chat: cm.greeting.map((i) => i.key), dash: dm.greeting.map((i) => i.key) });
  ok("1c. todayItems identical (same order — the ONE ranking)", same(cm.todayItems, dm.todayItems) && cm.todayItems.length > 0);
  ok("1d. inbox identical (line, counts, every entry's lifecycle)", same(cm.inbox, dm.inbox));
  ok("1e. financial semantics identical (line, coverage, surprises, windows per currency)", same(cm.financial, dm.financial) && !!dm.financial);
  ok("1f. learning identical and READ (the SAME owner history reached both)", same(cm.learning, dm.learning) && dm.learning.status === "READ", { chat: cm.learning, dash: dm.learning });
  ok("1g. the whole MOTION fact + the answer text + the served items are identical", same(fact(cMotion, "MOTION"), fact(dash.motion, "MOTION")) && same(fact(cMotion, "ANSWER"), fact(dash.motion, "ANSWER")) && same(cMotion.items, dash.motion.items));
  ok("1h. FINANCIAL_FORWARD identical (summary + obligations)", same(cForward.summary, dash.forward.summary) && same(cForward.items, dash.forward.items));
  ok("1i. needs_me identical (summary + every section item)", same(cNeeds.summary, dash.needsMe.summary) && same(cNeeds.items, dash.needsMe.items));
  ok("1j. modulo the request echo / timestamp the three payloads are byte-identical", same(strip(cMotion), strip(dash.motion)) && same(strip(cForward), strip(dash.forward)) && same(strip(cNeeds), strip(dash.needsMe)));
  const cp = executiveParity({ motion: cMotion, forward: cForward, needsMe: cNeeds });
  ok("1k. the parity fingerprint the route serves = the SAME function over the chat's three answers (production check compares like with like)", same(cp, dash.parity) && dash.parity.greeting.length > 0 && dash.parity.needsMe.today.length > 0 && Object.values(dash.parity.digests).every((d) => /^[0-9a-f]{16}$/.test(d)), { chat: cp.digests, dash: dash.parity.digests });

  section("2. THE HISTORY REALLY MATTERS — and both surfaces apply it the same way");
  const noHist = assembleExecutive({ motion: await dashQuery(SRC)("motion"), forward: await dashQuery(SRC)("forward"), needsMe: await dashQuery(SRC)("needsMe") }, { status: "NOT_READ", reasonHe: "x" }, NOW);
  const yahState = (m: ReturnType<typeof motionOf>) => m.inbox.entries.find((e) => e.lifecycle.itemId === U(101))?.lifecycle.state;
  ok("2a. the executed plan on יהלום changes the update's lifecycle (UNREAD without history → UNDERSTOOD_OPEN with it) on BOTH", yahState(motionOf(noHist.motion)) === "UNREAD" && yahState(dm) === "UNDERSTOOD_OPEN" && yahState(cm) === "UNDERSTOOD_OPEN", { none: yahState(motionOf(noHist.motion)), dash: yahState(dm), chat: yahState(cm) });
  ok("2b. the history request is the ONE shared request (owner-scoped, limit 50) — the same on both paths", historyCalls.length >= 2 && historyCalls.every((h) => h.ownerId === OWNER_ID && same(h.q, { limit: 50, before: null, since: null, actionId: null, entity: null })), historyCalls);
  ok("2d. the fingerprint is not blind: without the history the inbox digest differs from the served one", noHist.parity.digests.inbox !== dash.parity.digests.inbox && noHist.parity.digests.greeting.length === 16);
  ok("2c. the dashboard reports what it read (plans count), never the plan details", dash.history.status === "READ" && (dash.history as { plans: number }).plans === 1 && !JSON.stringify(dash.history).includes("planId"));

  section("3. NOT READABLE = SAID SO, on both (never 'nothing was done')");
  const dOff = await dashboard({ env: { PARTNER_ACT_ENABLED: "false" } });
  const cOff = motionOf(await chat(connector({ act: false }), "coo", "motion"));
  ok("3a. action layer off → the dashboard history is NOT_READ with the reason, motion learning NOT_READ", dOff.history.status === "NOT_READ" && motionOf(dOff.motion).learning.status === "NOT_READ");
  ok("3b. …and the chat without the act channel says exactly the same (identical motion)", same(cOff, motionOf(dOff.motion)));
  ok("3c. no signed-in owner id → NOT_READ (never another owner's history)", (await readOwnerActionHistory(null, MAIN_ENV, async () => actDeps())).status === "NOT_READ");
  ok("3d. a non-owner user id → the service refuses → NOT_READ", (await readOwnerActionHistory("someone-else", MAIN_ENV, async () => actDeps())).status === "NOT_READ");
  ok("3e. the history store unavailable → NOT_READ (never an empty history)", (await readOwnerActionHistory(OWNER_ID, MAIN_ENV, async () => actDeps({ plans: false }))).status === "NOT_READ");
  ok("3f. MCP-only deployment → NOT_READ (MAIN only)", (await readOwnerActionHistory(OWNER_ID, { ...MAIN_ENV, REDBLOODS_MCP_ONLY: "true" }, async () => actDeps())).status === "NOT_READ");
  const broken = await readExecutiveParts({ status: "NOT_READ", reasonHe: "x" }, async (part) => { if (part === "forward") throw new Error("boom"); return dashQuery(SRC)(part); }, NOW);
  ok("3g. one part that cannot be read keeps its own UNAVAILABLE status — the other parts are served, nothing becomes empty", broken.forward.status === "UNAVAILABLE" && broken.motion.status === "OK" && broken.needsMe.status === "OK" && !("items" in broken.forward));

  section("4. AUDIENCE: the Owner's INTERNAL dashboard and the EXTERNAL chat read the same three capabilities identically");
  for (const part of Object.keys(EXECUTIVE_PARTS) as ExecutivePart[]) {
    const a = await dashQuery(SRC, INTERNAL)(part), b = await dashQuery(SRC, EXTERNAL)(part);
    ok(`4. ${part}: INTERNAL ≡ EXTERNAL`, same(strip(a), strip(b)));
  }

  section("5. NO SECOND RULE: one ball, one inbox lifecycle, one money projection");
  const nm = dash.needsMe as { items: Array<{ fields: { section: string; entityKey: string; group?: string; open?: { kind: string; id?: string } } }>; summary: Sum };
  // the board serves the Owner's items (excluded = its own mode); the recorded ball per project is needs_me's projectBalls
  const balls = buildNeedsMe(SRC()).projectBalls;
  const ownerWait = (e: string) => balls[e.slice("project:".length)]?.ownerWait === true;
  const boardOwnerProjects = new Set(nm.items.filter((i) => ["today", "more_today"].includes(i.fields.section) && i.fields.open?.kind === "project").map((i) => `project:${i.fields.open!.id}`));
  const excludedExternal = new Set(Object.entries(balls).filter(([, b]) => !b.ownerWait && b.ball !== "NONE").map(([pid]) => `project:${pid}`));
  const motionAll = (dash.motion.items as Array<{ fields: { codes?: string[]; entity?: string | null } }>);
  const ownerBallEntities = motionAll.filter((i) => (i.fields.codes ?? []).includes("OWNER_BALL")).map((i) => i.fields.entity ?? null);
  ok("5a0. the fixture has motion OWNER_BALL items to check (non-vacuous)", ownerBallEntities.length > 0, ownerBallEntities);
  ok("5a. every motion OWNER_BALL rests on a recorded Owner wait of needs_me (never on a project the records give to someone else)", ownerBallEntities.every((e) => !e || (ownerWait(e) && !excludedExternal.has(e))), { ownerBallEntities, excluded: [...excludedExternal] });
  const yahM = [...dm.todayItems, ...((fact(dash.motion, "MOTION") as { all?: typeof dm.todayItems }).all ?? [])].find((i) => i.entity === K(P_YAHALOM));
  const yahReasons = (yahM as unknown as { reasonsHe?: string[] } | undefined)?.reasonsHe ?? [];
  ok("5b. יהלום: needs_me says the records hold the ball elsewhere; motion says 'אמרת לי' — never 'לפי הרשומות' (OWNER_SAID_WAITING, not OWNER_BALL)", excludedExternal.has(K(P_YAHALOM)) && !boardOwnerProjects.has(K(P_YAHALOM)) && !!yahM && !yahM.codes.includes("OWNER_BALL") && yahM.codes.includes("OWNER_SAID_WAITING") && yahReasons.some((r) => r.startsWith("אמרת לי")) && !yahReasons.some((r) => r.includes("לפי הרשומות משהו כאן מחכה לך")), yahM);
  const inboxNm = (fact(dash.needsMe, "INBOX") as { lifecycle: { counts: Record<string, number> } }).lifecycle.counts;
  ok("5c. NEEDS_OWNER is history-invariant: needs_me and the history-aware motion count the same", inboxNm.NEEDS_OWNER === dm.inbox.needsOwner && dm.inbox.counts.NEEDS_OWNER === inboxNm.NEEDS_OWNER, { needsMe: inboxNm, motion: dm.inbox.counts });
  const fwdWindows = fact(dash.forward, "WINDOWS") as unknown as Array<Record<string, Record<string, number>>>;
  ok("5d. the motion money line IS the FINANCIAL_FORWARD projection (same windows, same answer)", same((dm.financial as { windows: unknown }).windows, fwdWindows) && String((dm.financial as { lineHe: string }).lineHe) === String(fact(dash.forward, "ANSWER")));
  ok("5e. currencies are never summed (every window total is keyed by ONE currency) and coverage stays UNKNOWN", fwdWindows.every((w) => Object.values(w).every((t) => typeof t !== "object" || Object.keys(t).every((cur) => ["₪", "$", "€", "£"].includes(cur)))) && String(fact(dash.forward, "COVERAGE")) === "UNKNOWN");
  ok("5f. every motion item names a canonical entity key or none (Phase B joins ONLY by key — never by a name)", motionAll.every((i) => i.fields.entity == null || /^[a-z-]+:[0-9a-zA-Z_-]+$/.test(i.fields.entity)));

  section("6. ONE SELECTOR / ONE REQUEST / ONE MAPPING — wired, never restated");
  const mcp = code(read("lib/integrations/partner-mcp/mcp.ts")), srv = code(read("lib/integrations/partner-mcp/server.ts")), exe = code(read("lib/partner/gateway/executive.ts") + read("lib/partner/gateway/executive-server.ts")), oh = code(read("lib/partner/act/owner-history.ts")), route = code(read("app/api/partner/executive/route.ts"));
  ok("6a. the connector holds no derivation rule of its own (no capability / mode strings, no limit literal, no mapping)", /deps\.gateway\.historyDerivationFor\(\{ tool: a\.tool, capability: a\.capability, mode: a\.mode \?\? null \}\)/.test(mcp) && !/a\.capability === "owner_inbox"|a\.capability === "coo"/.test(mcp) && !/limit: 50/.test(mcp) && /deps\.gateway\.actionHistoryItemsOf\(h\)/.test(mcp) && /\.\.\.deps\.gateway\.actionHistoryRequest/.test(mcp));
  ok("6b. MAIN wires the connector with the Gateway's ONE selector / request / mapping", /historyDerivationFor, actionHistoryRequest: ACTION_HISTORY_REQUEST, actionHistoryItemsOf/.test(srv));
  ok("6c. the executive read uses the SAME selector + transform, composes the three capabilities and ranks nothing", /historyDerivationFor\(\{ tool: "partner_query"/.test(exe) && /deriveWithActionHistory\(derive, payload, items/.test(exe) && !/\.sort\(|score|rank|level ===|MUST|SHOULD/.test(exe));
  ok("6d. MAIN's history read = the SAME switch, service op, request and mapping", /env\[ACT_ENABLED_ENV\] !== "true"/.test(oh) && /planStatus\(\{ \.\.\.ACTION_HISTORY_REQUEST \}/.test(oh) && /actionHistoryItemsOf\(/.test(oh) && DASHBOARD_ACT_CLIENT_ID.length > 0);
  ok("6e. the route is GET-only, Owner-only, no-store; nothing written / pushed / cached", /export async function GET\(\)/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route) && /requireOwner\(\)/.test(route) && /no-store/.test(route) && !/\.from\(|sendPush|\.insert\(|\.from\([^)]*\)\.update\(|revalidate/.test(route + exe + oh));
  ok("6f. the history transform is a PURE function of (payload, history, now): the same input twice → the same output", same(deriveWithActionHistory("motion", cMotion, actionHistoryItemsOf({ status: "HISTORY", items: [] }), NOW.getTime()), deriveWithActionHistory("motion", cMotion, [], NOW.getTime())));

  section("7. PHASE B — the dashboard SHOWS the executive read (parse only, Sunny's order, join by canonical key only)");
  {
    // the motion fixture's finance has no open-expense list (FF answers UNKNOWN) → first prove that is said, then read
    // a finance state FF can read (₪ + $ realized this month)
    const unknownEx = parseExecutive(JSON.parse(JSON.stringify(dash)));
    ok("7-. FF UNKNOWN (finance not read) parses as read=false with its own sentence — never zeros / 'no movement'", !!unknownEx?.forward && unknownEx.forward.read === false && /לא קראתי את הכספים/.test(unknownEx.forward.answerHe ?? ""));
    const FIN_SRC = (): GatewaySources => { const g = SRC() as unknown as { finance: { value: { state: Record<string, unknown> } } }; const st = g.finance.value.state;
      g.finance.value.state = { ...st, openExpenses: { items: [] }, realized: { ...(st.realized as object), byCurrency: { "₪": { cashIn: 2000, cashOut: 500, net: 1500 }, "$": { cashIn: 0, cashOut: 200, net: -200 } } } }; return g as unknown as GatewaySources; };
    const dashF = await dashboard({ sources: FIN_SRC });
    const wire = JSON.parse(JSON.stringify(dashF)) as Record<string, unknown>;   // exactly what the browser receives
    const ex = parseExecutive(wire);
    const mFact = fact(dashF.motion, "MOTION") as unknown as { greeting: Array<{ key: string }>; todayItems: Array<{ key: string }>; closeLoops: Array<{ key: string }>; label: Array<{ key: string }>; more: number; week: { lineHe: string | null }; inbox: { lineHe: string | null }; financial: { decided: string[] } | null };
    const keys = (a: Array<{ key: string }>) => a.map((i) => i.key);
    ok("7a. the executive read parses (motion, forward and needs_me all present)", !!ex && !!ex.motion && !!ex.forward && !!ex.needsMe, ex && { m: !!ex.motion, f: !!ex.forward, n: !!ex.needsMe });
    const m = ex!.motion!, f = ex!.forward!;
    ok("7b. B1 greeting = motion.greeting exactly (same keys, same order, ≤3)", same(keys(m.greeting), keys(mFact.greeting)) && m.greeting.length <= 3 && m.greeting.length > 0, keys(m.greeting));
    ok("7c. todayItems / closeLoops / label keep Sunny's order (no re-sort)", same(keys(m.todayItems), keys(mFact.todayItems)) && same(keys(m.closeLoops), keys(mFact.closeLoops)) && same(keys(m.label), keys(mFact.label)) && m.more === mFact.more);
    ok("7d. B2 state line = Sunny's own week / inbox lines", m.weekLineHe === mFact.week.lineHe && m.inboxLineHe === mFact.inbox.lineHe);
    const fw = fact(dashF.forward, "WINDOWS") as unknown as Array<Record<string, unknown>>;
    ok("7e0. FF reads this finance", f.read === true);
    ok("7e. B5 'בפועל החודש' = FINANCIAL_FORWARD ACTUAL_MONTH; 7 days = its first window; per currency", same(f.actualMonth, fact(dashF.forward, "ACTUAL_MONTH")) && same(f.week?.hardOutflow, fw[0].hardOutflow) && same(f.week?.expectedInflow, fw[0].expectedInflow) && Object.keys(f.actualMonth).every((c) => ["₪", "$", "€", "£"].includes(c)), { a: f.actualMonth, w: f.week });
    ok("7f. B5 answer / decisions come from FF / motion (never a second money rule)", f.answerHe === String(fact(dashF.forward, "ANSWER")) && same(m.money?.decided ?? [], mFact.financial?.decided ?? []));
    ok("7g. the coverage sentence is the 'לפי התזרים הרשום' one (no bank balance claimed)", !!f.coverageHe && f.coverageHe.startsWith("לפי התזרים הרשום") && !/יש מספיק כסף|העסק יציב|(^|[.·—] )יש כיסוי/.test(JSON.stringify({ ...f, coverageHe: null })));
    const nb = parseBoard(ex!.needsMe!), nbDirect = parseBoard(JSON.parse(JSON.stringify(dashF.needsMe)) as Record<string, unknown>);
    ok("7h. B3 'מחכה לך' = the SAME needs_me board through the SAME parser", !!nb && same(nb, nbDirect) && nb.today.length > 0);
    ok("7i. a part that is not OK parses as null (never an empty list)", (() => { const e = parseExecutive({ ...wire, motion: { status: "UNAVAILABLE" }, forward: { status: "UNAVAILABLE" }, needsMe: { status: "FORBIDDEN" } }); return !!e && e.motion === null && e.forward === null && e.needsMe === null; })() && parseExecutive({ error: "x" }) === null && parseExecutive(null) === null);
    ok("7j. history NOT_READ is carried through (said, never 'nothing was done')", parseExecutive({ ...wire, history: { status: "NOT_READ", reasonHe: "x" } })!.history.status === "NOT_READ");

    // the join: exact canonical keys only
    const idx = indexByEntity(m);
    ok("7k. the index holds only canonical keys, each from a served item (first served wins)", [...idx.keys()].every((k) => isCanonicalKey(k)) && [...idx.entries()].every(([k, i]) => servedItems(m).find((x) => x.entity === k || x.entities.includes(k))?.key === i.key) && idx.size > 0, [...idx.keys()]);
    const it = (o: Partial<ExecItem>): ExecItem => ({ key: "k", entity: null, entities: [], level: "SHOULD", codes: ["X"], titleHe: "יהלום", reasonsHe: ["r"], move: null, epistemic: "DERIVED", ...o });
    const fake = { ...m, todayItems: [it({ key: "a", entity: K(P_YAHALOM) }), it({ key: "b", entity: K(P_YAHALOM), level: "MUST" }), it({ key: "c", entity: null, titleHe: "מאור" })], atRisk: [], closeLoops: [], label: [], watch: [] } as ExecMotion;
    const fi = indexByEntity(fake);
    ok("7l. the first served item for a key wins (no level ranking of our own)", fi.get(K(P_YAHALOM))?.key === "a");
    ok("7m. never by a name: a key-less item named like a row enriches nothing; a non-canonical key enriches nothing", enrichmentFor(fi, "מאור") === null && enrichmentFor(fi, null) === null && enrichmentFor(fi, "project:yahalom") === null && enrichmentFor(fi, `project:${P_MAOR}`) === null && fi.size === 1);
    const PID = "aaaaaaaa-1111-2222-3333-444444444444", SID = "bbbbbbbb-1111-2222-3333-444444444444";
    const tl = buildTimeline({ today: TODAY, projects: [{ id: PID, name: "יהלום", status: "בעבודה", deadline: TODAY }], shows: [{ id: SID, name: "הופעה", date: TODAY, status: "נסגר" }],
      sessions: [{ id: "s1", project_id: PID, date: TODAY, status: "מתוכנן" }, { id: "s2", show_id: SID, date: TODAY, status: "מתוכנן", session_type: "חזרה" }, { id: "s3", date: TODAY, status: "מתוכנן", title: "יהלום" }],
      tasks: [{ id: "t1", title: "יהלום", due_date: TODAY, status: "פתוח" }], calendar: [{ id: "e1", title: "סשן יהלום", startTime: `${TODAY}T10:00:00`, matchedProjectId: PID }] });
    const ent = Object.fromEntries(tl.map((t) => [t.key, t.entity]));
    ok("7n. timeline rows carry a key ONLY from their own id / FK: deadline + project session → project, show + show rehearsal → show; task, key-less session and a calendar text match → none",
      ent[`deadline:${PID}`] === `project:${PID}` && ent["session:s1"] === `project:${PID}` && ent[`show:${SID}`] === `show:${SID}` && ent["session:s2"] === `show:${SID}` && ent["session:s3"] === null && ent["task:t1"] === null && ent["cal:e1"] === null, ent);
    ok("7o. opens only existing drawers / pages", same(openOfEntity(`project:${PID}`), { kind: "project", id: PID }) && same(openOfEntity(`label-artist:${PID}`), { kind: "href", href: "/label" }) && openOfEntity("client:x").kind === "none" && openOfEntity(null).kind === "none");
    ok("7p. money per currency, never summed", totalsHe({ "$": 750, "₪": 2213 }) === "$750 + ₪2,213" && totalsHe({}) === "0");

    const ui = code(read("components/dashboard-v2/DashboardV2.tsx")), lib = code(read("lib/dashboard-executive.ts"));
    ok("7q. the dashboard reads ONE executive endpoint; no /api/coo/brief, no /api/transactions, no direct needs_me fetch, no financeMonth", ui.includes('"/api/partner/executive"') && !ui.includes("/api/coo/brief") && !ui.includes("/api/transactions") && !ui.includes("capability=needs_me") && !ui.includes("financeMonth"));
    ok("7r. no ranking on the page or in the mapper (no sort / score / level comparison)", !/\.sort\(|score|level ===|\.level >|\.level </.test(lib) && !/\.sort\(|score/.test(ui));
    ok("7s. enrichment is called only with a canonical key (the row's entity or project:<release projectId>), never a title / name", [...ui.matchAll(/enrichmentFor\(([^)]*)\)/g)].every((x) => /^sunnyIdx, `project:\$\{r\.item\.projectId\}`$|^sunny, it\.entity$/.test(x[1])) && [...ui.matchAll(/enrichmentFor\(/g)].length === 2);
    ok("7t. the 'לא מסונן' fallback stays, the page writes only 'עדכון לסאני', and nothing pushes / writes the calendar", /לא מסונן/.test(ui) && /buildNeedsMe\(\{/.test(ui) && [...ui.matchAll(/method:\s*"(POST|PATCH|PUT|DELETE)"/g)].length === 1 && !/\/api\/push|create-event|create-task/.test(ui));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
