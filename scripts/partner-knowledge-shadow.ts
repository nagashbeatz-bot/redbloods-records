/**
 * Redbloods Partner — Unified Knowledge Gateway READ-ONLY shadow run (developer tool).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-knowledge-shadow.ts [--full]
 *
 * Runs every registered capability (each mode) and the Owner's QA questions through the REAL Gateway server binding
 * with the MCP audience (EXTERNAL + Owner grant), against the live data. Fetch is guarded to GET/HEAD against the
 * Supabase host only (any write, RPC or other host throws and is reported). Nothing is written.
 */
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = /^(SUPABASE_URL|SUPABASE_SECRET_KEY)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("missing SUPABASE_* in .env.local");
const SB_HOST = new URL(process.env.SUPABASE_URL).host;
const blocked: string[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
  if (!((method === "GET" || method === "HEAD") && url.host === SB_HOST)) { blocked.push(`${method} ${url.host}${url.pathname}`); throw new Error(`READ-ONLY GUARD blocked ${method} ${url.host}${url.pathname}`); }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const AUD = { channel: "EXTERNAL", ownerAuthorized: true } as const;
const t = (g: { text: string } | null | undefined) => g?.text ?? "";

async function main() {
  const gw = await import("../lib/partner/gateway/server");
  const { PARTNER_KNOWLEDGE_REGISTRY: reg } = await import("../lib/partner/knowledge/catalog");
  const ctx = gw.createCompanyReadContext();
  console.log("REDBLOODS PARTNER — UNIFIED KNOWLEDGE SHADOW (read-only, MCP audience)");
  console.log(`capabilities visible to the connector: ${gw.describePartnerKnowledge(AUD).map((c) => c.id).join(", ")}`);
  const full = process.argv.includes("--full");
  for (const c of reg.all()) {
    for (const mode of Object.keys(c.modes)) {
      const r = await gw.queryPartnerKnowledge({ capability: c.id, mode }, AUD, ctx);
      const size = JSON.stringify(r).length;
      console.log(`\n[${r.status}] ${c.id}/${mode} · items ${r.page?.returned ?? 0}/${r.page?.total ?? 0} · completeness ${r.completeness} · ${size} chars${r.missing.length ? ` · missing: ${r.missing.map((m) => m.fact).join(", ")}` : ""}`);
      for (const s of r.summary.slice(0, 4)) console.log(`   Σ ${s.code} [${s.epistemic}] ${JSON.stringify(s.value).slice(0, 160)}`);
      for (const i of r.items.slice(0, full ? 50 : 3)) console.log(`   · [${i.epistemic}/${i.freshness}${i.relationQuality ? `/${i.relationQuality}` : ""}] ${t(i.label).slice(0, 110)}`);
      for (const cv of r.coverage.slice(0, 2)) console.log(`   ~ ${t(cv).slice(0, 160)}`);
    }
  }
  console.log("\n══ QA equivalents");
  const brief = await gw.getPartnerBrief(ctx, AUD);
  console.log(`1 "מה חשוב עכשיו?" → brief items: ${brief.items.map((i) => `${i.category}:${t(i.headline).slice(0, 60)}`).join(" | ")}`);
  const needs = await gw.queryPartnerKnowledge({ capability: "owner_needs" }, AUD, ctx);
  console.log(`2 "מה אתה צריך ממני?" → ${needs.items.map((i) => `${i.fields.kind}:${t(i.label).slice(0, 70)}`).join(" | ")} · deferred ${JSON.stringify(needs.summary.find((s) => s.code === "DEFERRED_QUESTIONS")?.value)}`);
  const shalev = await gw.resolvePartnerEntity("שליו", ctx);
  const key = shalev.candidates.find((c) => c.key.startsWith("label-artist:"))?.key ?? shalev.candidates[0]?.key;
  console.log(`3 "מה עם שליו?" → resolve ${shalev.status} ${shalev.candidates.map((c) => c.key.split(":")[0]).join(",")}`);
  if (key) {
    const e = await gw.getPartnerEntity(key, ctx, AUD);
    console.log(`   entity ${e.status} · openQuestions: ${e.openQuestions.map((q) => q.questionType).join(",") || "—"} · knowledge sections: ${e.knowledge.map((k) => `${k.capability}(${k.items.length}/${k.total})`).join(", ")} · ${JSON.stringify(e).length} chars`);
  }
  const shows = await gw.queryPartnerKnowledge({ capability: "shows" }, AUD, ctx);
  console.log(`4 "יש הופעות?" → ${shows.status} total ${shows.page?.total} · ${shows.summary.map((s) => `${s.code}=${JSON.stringify(s.value)}`).join(" · ")}`);
  const hist = await gw.queryPartnerKnowledge({ capability: "shows", mode: "recent", limit: 10 }, AUD, ctx);
  console.log(`5 "היסטוריית הופעות" → ${hist.items.map((i) => `${i.fields.date} ${t(i.label)} [${i.fields.status}/${i.fields.paymentStatus}]`).join(" | ")}`);
}

main()
  .catch((e) => { console.error("SHADOW FAILED:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => { console.log(`\nREAD-ONLY GUARD: ${blocked.length ? `BLOCKED ${blocked.length}: ${blocked.join(", ")}` : "0 blocked non-GET / off-host requests"}`); });
