/**
 * Redbloods Partner MCP connector — READ-ONLY latency benchmark + production-data output equivalence (developer tool).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-mcp-benchmark.ts [runs=7]
 *
 * Fetch is guarded to GET/HEAD against the Supabase host only (any write / RPC / other host throws and is
 * reported). No OAuth tables are needed: the MCP adapter runs with a stub authenticator and a no-op audit.
 */
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = /^(SUPABASE_URL|SUPABASE_SECRET_KEY)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SB_HOST = new URL(process.env.SUPABASE_URL!).host;
const blocked: string[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
  if (!((method === "GET" || method === "HEAD") && url.host === SB_HOST)) { blocked.push(`${method} ${url.host}${url.pathname}`); throw new Error(`READ-ONLY GUARD blocked ${method} ${url.host}${url.pathname}`); }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const RUNS = Number(process.argv[2] ?? 7);
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (xs: number[]) => ({ p50: pct(xs, 50), p95: pct(xs, 95), max: Math.max(...xs), min: Math.min(...xs) });

async function main() {
  const gw = await import("../lib/partner/gateway/server");
  const { handleMcpHttp } = await import("../lib/integrations/partner-mcp/mcp");
  const { readMcpConfig } = await import("../lib/integrations/partner-mcp/config");
  const { SlidingWindowLimiter } = await import("../lib/integrations/partner-mcp/rate-limit");
  const r = await gw.resolvePartnerEntity("קלינטון");
  const dj = r.candidates.find((c) => c.type === "dj")!.key;
  const karov = (await gw.resolvePartnerEntity("קרוב אלייך")).candidates[0].key;
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["partner_brief", () => gw.getPartnerBrief()],
    ["entity vendor:VICTOR", () => gw.getPartnerEntity("vendor:VICTOR")],
    [`entity ${dj.slice(0, 12)}… (Clinton)`, () => gw.getPartnerEntity(dj)],
    [`entity ${karov.slice(0, 16)}… (קרוב אלייך)`, () => gw.getPartnerEntity(karov)],
    ["partner_resolve Victor", () => gw.resolvePartnerEntity("Victor")],
  ];
  const out: Record<string, unknown> = {};
  for (const [name, f] of cases) {
    const t: number[] = [];
    for (let i = 0; i < RUNS; i++) { const s = performance.now(); await f(); t.push(Math.round(performance.now() - s)); }
    out[name] = stats(t);
  }
  // per-source timing: one fresh request-scoped context per run, each loader timed on its own
  const src: Record<string, number[]> = {};
  for (let i = 0; i < Math.min(RUNS, 5); i++) {
    const ctx = gw.createGatewayReadContext();
    for (const [k, f] of [["company state (COO + Eyes)", ctx.state], ["finance live", ctx.finance], ["memory (reuses finance)", ctx.memory], ["cases (reuses state)", ctx.cases], ["action surface (reuses state+finance)", ctx.actions], ["recent outcomes", ctx.outcomes]] as const) {
      const s = performance.now(); await f(); (src[k] ??= []).push(Math.round(performance.now() - s));
    }
  }
  out.sources = Object.fromEntries(Object.entries(src).map(([k, v]) => [k, stats(v)]));

  // MCP adapter vs direct Gateway on the SAME request-scoped read (production data) — semantic equivalence
  const cfgR = readMcpConfig({ PARTNER_MCP_ENABLED: "true", PARTNER_MCP_BASE_URL: "https://partner-staging.example.com", PARTNER_MCP_SECRET: "x".repeat(40) });
  if (!cfgR.ok) throw new Error("config");
  const ctx = gw.createCompanyReadContext();
  const AUD = { channel: "EXTERNAL", ownerAuthorized: true } as const;
  const deps = {
    config: cfgR.config,
    authenticate: async () => ({ ok: true as const, principal: { tokenId: "bench", clientId: "bench", userId: "bench", scope: "partner:read" } }),
    gateway: {
      brief: async () => (await gw.getPartnerBrief(ctx)) as unknown as Record<string, unknown>,
      resolve: async (q: string) => (await gw.resolvePartnerEntity(q, ctx)) as unknown as Record<string, unknown>,
      entity: async (k: string) => (await gw.getPartnerEntity(k, ctx)) as unknown as Record<string, unknown>,
      query: async (q: { capability: string }) => (await gw.queryPartnerKnowledge(q, { channel: "EXTERNAL", ownerAuthorized: true }, ctx)) as unknown as Record<string, unknown>,
      capabilityIndex: () => gw.describePartnerKnowledge({ channel: "EXTERNAL", ownerAuthorized: true }),
    },
    limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 1000 }]), audit: async () => undefined, auditRejected: async () => undefined, nowMs: () => Date.now(),
  };
  const eq: Record<string, boolean> = {};
  for (const [tool, args, direct] of [
    ["partner_entity", { key: "vendor:VICTOR" }, () => gw.getPartnerEntity("vendor:VICTOR", ctx)],
    ["partner_entity", { key: "recurring:VICTOR_SALARY:2026-08" }, () => gw.getPartnerEntity("recurring:VICTOR_SALARY:2026-08", ctx)],
    ["partner_resolve", { query: "קלינטון" }, () => gw.resolvePartnerEntity("קלינטון", ctx)],
    ["partner_brief", {}, () => gw.getPartnerBrief(ctx)],
    ["partner_query", { capability: "catalog" }, () => gw.queryPartnerKnowledge({ capability: "catalog" }, AUD, ctx)],
    ["partner_query", { capability: "owner_needs" }, () => gw.queryPartnerKnowledge({ capability: "owner_needs" }, AUD, ctx)],
    ["partner_query", { capability: "shows" }, () => gw.queryPartnerKnowledge({ capability: "shows" }, AUD, ctx)],
    ["partner_query", { capability: "shows", mode: "recent", limit: 10 }, () => gw.queryPartnerKnowledge({ capability: "shows", mode: "recent", limit: 10 }, AUD, ctx)],
    ["partner_query", { capability: "finance_receivables" }, () => gw.queryPartnerKnowledge({ capability: "finance_receivables" }, AUD, ctx)],
  ] as const) {
    const res = await handleMcpHttp({ method: "POST", header: (n) => (n === "authorization" ? "Bearer x" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) }, deps);
    const sc = JSON.parse(res.body!).result;
    const d = await direct();
    eq[`${tool} ${JSON.stringify(args)}`] = JSON.stringify(sc.structuredContent) === JSON.stringify(d) && sc.content[0].text === JSON.stringify(d) && sc.content[0].text.length < cfgR.config.maxResultChars;
  }
  out.equivalence = eq;
  const list = JSON.parse((await handleMcpHttp({ method: "POST", header: (n) => (n === "authorization" ? "Bearer x" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }, deps)).body!).result.tools as Array<{ name: string; description: string; annotations: { readOnlyHint: boolean } }>;
  out.toolsList = { names: list.map((t) => t.name), allReadOnly: list.every((t) => t.annotations.readOnlyHint), queryDescriptionChars: list.find((t) => t.name === "partner_query")?.description.length, advertises: ["shows", "owner_needs", "finance_receivables", "integrity", "label_roster"].filter((id) => list.find((t) => t.name === "partner_query")?.description.includes(`- ${id} (`)) };
  out.blockedWrites = blocked;
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
