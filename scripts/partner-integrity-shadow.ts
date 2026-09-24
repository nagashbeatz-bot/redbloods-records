/**
 * Redbloods Partner — Company Integrity Register READ-ONLY shadow run (developer tool).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-integrity-shadow.ts [--json]
 *
 * Builds the register from one CompanyReadContext against the live data and prints the findings and the (at most 2)
 * Owner questions. Fetch is guarded to GET/HEAD against the Supabase host only (any write, RPC or other host throws
 * and is reported). Nothing is written, nothing is sent.
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

async function main() {
  const { createCompanyReadContext } = await import("../lib/partner/company/read-context");
  const ctx = createCompanyReadContext();
  const r = await ctx.integrity();
  if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`REDBLOODS PARTNER — COMPANY INTEGRITY SHADOW (read-only) · ${r.schemaVersion} · ${r.observedAt}`);
  console.log(`sources: ${r.sources.map((s) => `${s.source}=${s.status}`).join(" | ")}`);
  console.log(`definitions: ${r.definitionsApplied.join(", ")}`);
  console.log(`summary: ${JSON.stringify(r.summary)}  findings=${r.findings.length}`);
  for (const f of r.findings) {
    console.log(`\n[${f.severity}] ${f.type} · ${f.subject.key} "${f.subject.label ?? ""}" · ${f.stance}/${f.epistemic}${f.ownerInputRequired ? " · OWNER" : ""}`);
    console.log(`   ${f.interpretationHe}`);
    for (const e of f.evidence) console.log(`   · ${e.source}: ${e.fact} = ${JSON.stringify(e.value)?.slice(0, 260)}`);
  }
  console.log(`\nQUESTIONS (${r.questions.length}, deferred ${r.deferredQuestions}, answered ${r.answeredQuestions.length}):`);
  for (const q of r.questions) console.log(`   ${q.questionType} · ${q.subject.label} · "${q.textHe}" · options=${q.options.map((o) => o.code).join("/")} · prev=${q.previousAnswer?.answerCode ?? "—"} · fp=${q.fingerprint.slice(0, 12)}…`);
}

main()
  .catch((e) => { console.error("SHADOW FAILED:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => { console.log(`\nREAD-ONLY GUARD: ${blocked.length ? `BLOCKED ${blocked.length}: ${blocked.join(", ")}` : "0 blocked non-GET / off-host requests"}`); });
