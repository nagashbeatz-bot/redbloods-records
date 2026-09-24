/**
 * Redbloods Partner — Organizational Memory V1 READ-ONLY shadow (developer tooling).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-memory-shadow.ts [VICTOR|<project name>...]
 *
 * Fetch is guarded to GET/HEAD against the Supabase host only (any write, RPC or other host throws).
 * Prints, per requested entity: live facts, Owner decisions, observations, actions, outcomes, conflicts,
 * resolutions, pattern candidates and the questions the memory pre-flight prevented. Nothing is written.
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
  const { loadPartnerMemory } = await import("../lib/partner/memory/server");
  const { recallEntity, VICTOR_VENDOR } = await import("../lib/partner/memory/core");
  const { loadFinanceLive } = await import("../lib/partner/finance/server");
  const { supabase } = await import("../lib/supabase");
  const now = new Date();
  const memory = await loadPartnerMemory(now);
  const live = await loadFinanceLive(now);
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["VICTOR", "מראות", "קרוב אלייך"];
  const { data: projects } = await supabase.from("projects").select("id,name");
  const out: Record<string, unknown> = { sources: memory.sources, builtAt: memory.builtAt };
  for (const t of targets) {
    const keys = t === "VICTOR" ? [VICTOR_VENDOR] : (projects ?? []).filter((p: { name: string }) => p.name === t).map((p: { id: string }) => `project:${p.id}`);
    out[t] = keys.map((k) => ({
      key: k,
      entities: recallEntity(memory, k).map((e) => ({
        entity: e.entity.key, period: e.entity.period,
        facts: e.facts.map((f) => ({ code: f.code, epistemic: f.epistemic, value: f.value })),
        ownerDecisions: e.ownerDecisions.map((d) => ({ questionType: d.questionType, answerCode: d.answerCode, value: d.answerValueYmd, status: d.status, contextId: d.contextId })),
        observations: e.observations.map((o) => ({ issue: o.signature.issueType, current: o.current, contested: o.contested })),
        actions: e.actions.map((a) => ({ actionType: a.actionType, head: a.headEventType, events: a.events.map((x) => x.eventType), ownerContextIds: a.ownerContextIds })),
        outcomes: e.outcomes.map((o) => ({ state: o.state, expected: o.expectedValue, current: o.currentValue })),
        conflicts: e.conflicts.map((c) => ({ code: c.code, values: c.values, winning: c.winning })),
        resolutions: e.resolutions.map((r) => ({ code: r.code, issue: r.resolvedIssue })),
      })).filter((e) => e.facts.length + e.ownerDecisions.length + e.observations.length + e.actions.length + e.outcomes.length + e.conflicts.length + e.resolutions.length > 0),
    }));
  }
  out.patternCandidates = memory.patternCandidates;
  out.confirmedPatterns = memory.confirmedPatterns;
  out.preflight = live.status === "OK" ? live.view.preflight.map((p) => ({ questionType: p.questionType, questionId: p.questionId, status: p.verdict.status, suppress: p.verdict.suppress, detail: p.verdict.detail })) : live.status;
  out.surfacedQuestions = live.status === "OK" ? live.integrity.top.questions.map((q) => q.questionType) : null;
  out.blockedWrites = blocked;
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
