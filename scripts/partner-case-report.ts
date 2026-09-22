/**
 * Partner Case Engine — SHADOW MODE production report (Phase E.1).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-case-report.ts
 *
 * READ-ONLY. Does NOT advance the production Change Awareness baseline —
 * unlike scripts/partner-change-awareness-report.ts (D.3), this script never
 * calls runPartnerChangeAwareness() (which saves). It calls
 * loadPartnerBaseline() (a plain SELECT) directly, then the PURE
 * comparePartnerChangeSnapshots() — no save anywhere in this file. The
 * partner_change_baseline row this script reads is left exactly as it was
 * found.
 *
 * Safety scaffold: only SUPABASE_URL + SUPABASE_SECRET_KEY read from
 * .env.local; fetch guarded to GET/HEAD against the Supabase host only (a
 * POST/PATCH attempt — which this script should never make — would be
 * blocked and would fail the run loudly rather than silently writing).
 *
 * Cases are NOT surfaced anywhere else — no UI, no notification, no Agent
 * Alert. This script is the only place they are visible, for manual Owner
 * review.
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

const blocked: { method: string; url: string }[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
  const safe = (method === "GET" || method === "HEAD") && url.host === SB_HOST;
  if (!safe) { blocked.push({ method, url: `${url.host}${url.pathname}` }); throw new Error(`READ-ONLY GUARD blocked ${method} ${url.host}${url.pathname} — this script must never write.`); }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

function count<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}
function fmt(rec: Record<string, number>): string {
  return Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)";
}

async function main() {
  const { buildPartnerCompanyState } = await import("../lib/partner/eyes/build");
  const { buildPartnerCases } = await import("../lib/partner/cases/engine");
  const { loadPartnerBaseline } = await import("../lib/partner/baseline/store");
  const { buildPartnerChangeSnapshot } = await import("../lib/partner/changes/snapshot");
  const { comparePartnerChangeSnapshots } = await import("../lib/partner/changes/compare");

  console.log("── 1. Build current production state (read-only) ──");
  const state = await buildPartnerCompanyState();
  console.log(`  capturedAt=${state.capturedAt} todayIL=${state.todayIL}`);

  console.log("\n── 2. Load the EXISTING baseline (read-only SELECT — this script never saves) ──");
  const baseline = await loadPartnerBaseline();
  console.log(`  baseline exists: ${baseline !== null}${baseline ? ` (savedAt=${baseline.savedAt}, snapshot.capturedAt=${baseline.snapshot.capturedAt})` : ""}`);

  let changes: Awaited<ReturnType<typeof comparePartnerChangeSnapshots>>["changes"] = [];
  let changeContext: { previousCapturedAt: string | null; currentCapturedAt: string } | null = null;
  if (baseline) {
    console.log("\n── 3. Pure comparison against the loaded baseline (NO save — comparePartnerChangeSnapshots only) ──");
    const currentSnapshot = buildPartnerChangeSnapshot(state);
    const comparison = comparePartnerChangeSnapshots(baseline.snapshot, currentSnapshot);
    changes = comparison.changes;
    changeContext = { previousCapturedAt: comparison.previousCapturedAt, currentCapturedAt: comparison.currentCapturedAt };
    console.log(`  changes since baseline: ${changes.length} | diagnostics: ${comparison.diagnostics.length} | comparable: ${comparison.comparable}`);
    if (comparison.diagnostics.length) for (const d of comparison.diagnostics) console.log(`    [${d.code}] ${d.domain ?? "(snapshot-level)"}: ${d.message}`);
  } else {
    console.log("\n── 3. No baseline exists — skipping change comparison, building STATE Cases only ──");
  }

  console.log("\n── 4. Build Partner Cases (STATE" + (changes.length ? " + CHANGE" : "") + ") — SHADOW MODE, not surfaced anywhere else ──");
  const cases = buildPartnerCases({ state, today: state.todayIL, changes, changeContext });

  console.log(`\nTotal Cases: ${cases.length}`);
  console.log(`By classification: ${fmt(count(cases.map((c) => c.classification)))}`);
  console.log(`By type: ${fmt(count(cases.map((c) => c.caseType)))}`);
  console.log(`By subject type: ${fmt(count(cases.map((c) => c.subjectType)))}`);
  console.log(`By status: ${fmt(count(cases.map((c) => c.status)))}`);
  console.log(`By createdFrom: ${fmt(count(cases.map((c) => c.createdFrom)))}`);

  const ruleUse: Record<string, number> = {};
  for (const c of cases) for (const r of c.ownerRulesApplied) ruleUse[r] = (ruleUse[r] ?? 0) + 1;
  console.log(`\nOwner Rules applied (counts): ${fmt(ruleUse)}`);

  const wpUse: Record<string, number> = {};
  for (const c of cases) for (const r of c.workingPrinciplesApplied) wpUse[r] = (wpUse[r] ?? 0) + 1;
  console.log(`Working Principles applied (counts): ${fmt(wpUse)}`);

  const withHypotheses = cases.filter((c) => c.hypotheses.length > 0);
  console.log(`\nCases with >=1 hypothesis: ${withHypotheses.length}/${cases.length}`);
  const withWeakRelation = cases.filter((c) => c.dataQuality.relationQuality !== undefined);
  console.log(`Cases with a weak (non-ID) relation noted: ${withWeakRelation.length}/${cases.length}`);
  const needsContext = cases.filter((c) => c.status === "NEEDS_CONTEXT");
  console.log(`Cases with status NEEDS_CONTEXT: ${needsContext.length}/${cases.length}`);
  const withUnknowns = cases.filter((c) => c.unknowns.length > 0);
  console.log(`Cases with >=1 explicit unknown: ${withUnknowns.length}/${cases.length}`);

  console.log("\n── Structural sample (no private data — ids/types/counts only) ──");
  const sampleSize = cases.length > 20 ? 20 : cases.length;
  for (const c of cases.slice(0, sampleSize)) {
    console.log(`  ${c.id}`);
    console.log(`    classification=${c.classification} status=${c.status} createdFrom=${c.createdFrom}`);
    console.log(`    facts=${c.facts.length} derived=${c.derivedFacts.length} hypotheses=${c.hypotheses.length} unknowns=${c.unknowns.length}`);
    console.log(`    ownerRulesApplied=[${c.ownerRulesApplied.join(", ")}] workingPrinciplesApplied=[${c.workingPrinciplesApplied.join(", ")}]`);
  }
  if (cases.length > sampleSize) console.log(`  ... and ${cases.length - sampleSize} more (summarized by type/classification above, not dumped individually)`);

  console.log(`\nblocked requests during this run: ${blocked.length} (must be 0 — this script must never write)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-case-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
