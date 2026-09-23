/**
 * Partner decision state + Suggested Actions — SHADOW MODE dry run (Phase F.1F).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-suggested-actions-report.ts
 *
 * READ-ONLY. Fetch guarded to GET/HEAD against the Supabase host only (any
 * write attempt throws). The baseline is loaded with a plain SELECT and never
 * saved. Owner Context is read through the server-only store's read APIs.
 * Nothing is persisted, approved or executed; the project is not touched.
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
  const { supabase } = await import("../lib/supabase");
  const { buildPartnerCompanyState } = await import("../lib/partner/eyes/build");
  const { buildPartnerCases } = await import("../lib/partner/cases/engine");
  const { loadPartnerBaseline } = await import("../lib/partner/baseline/store");
  const { buildPartnerChangeSnapshot } = await import("../lib/partner/changes/snapshot");
  const { comparePartnerChangeSnapshots } = await import("../lib/partner/changes/compare");
  const { deriveCaseDecisionState } = await import("../lib/partner/investigation");
  const { listOwnerContexts } = await import("../lib/partner/investigation/context-store");
  const { deriveSuggestedActions } = await import("../lib/partner/actions");

  const count = async (table: string) => {
    const { count: n, error } = await supabase.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`${table} count failed: ${error.message}`);
    return n;
  };
  const before = { partner_owner_context: await count("partner_owner_context"), partner_feedback: await count("partner_feedback"), baselineSavedAt: (await loadPartnerBaseline())?.savedAt };

  const baseline = await loadPartnerBaseline();
  const state = await buildPartnerCompanyState();
  let changes: Awaited<ReturnType<typeof comparePartnerChangeSnapshots>>["changes"] = [];
  let changeContext: { previousCapturedAt: string | null; currentCapturedAt: string } | null = null;
  if (baseline) {
    const cmp = comparePartnerChangeSnapshots(baseline.snapshot, buildPartnerChangeSnapshot(state));
    changes = cmp.changes;
    changeContext = { previousCapturedAt: cmp.previousCapturedAt, currentCapturedAt: cmp.currentCapturedAt };
  }
  const cases = buildPartnerCases({ state, today: state.todayIL, changes, changeContext });
  const history = await listOwnerContexts();
  if (history.status !== "OK" && history.status !== "NO_CONTEXT") throw new Error(`owner context read: ${history.status}`);
  const contexts = history.status === "OK" ? history.contexts : [];
  const names = new Map((state.domains.projects.data?.open ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));

  const caseIds = [...new Set(contexts.map((c) => c.caseId))].sort();
  console.log(`todayIL=${state.todayIL} | Cases=${cases.length} | Owner Contexts=${contexts.length} | Cases with context=${caseIds.length}`);
  for (const caseId of caseIds) {
    const c = cases.find((x) => x.id === caseId);
    console.log(`\n── ${caseId} ──`);
    if (!c) { console.log("  Case no longer exists (condition resolved) — nothing to propose."); continue; }
    const ds = deriveCaseDecisionState(c, contexts.filter((x) => x.caseId === caseId));
    const r = deriveSuggestedActions({ case: c, decisionState: ds, subjectLabelHe: c.subjectType === "project" ? names.get(c.subjectId) ?? null : null });
    console.log(JSON.stringify({
      readiness: ds.readiness,
      CURRENT_FACTS: ds.facts.map((f) => `${f.field}=${f.value}`),
      OWNER_CONTEXTS: ds.ownerContexts.map((x) => `${x.contextId} ${x.questionType}:${x.answerCode}${x.answerValue ? ` → ${x.answerValue.ymd}` : ""} (${x.applicability}${x.triggerContextId ? `, trigger ${x.triggerContextId}` : ""})`),
      INTENDED: ds.selectedBusinessValues.map((v) => ({ code: v.code, status: v.epistemicStatus, value: v.value.ymd, persistedFact: v.persistedFact, source: v.source })),
      DERIVED: ds.derived.map((d) => d.statementHe),
      HYPOTHESES: ds.hypotheses.map((h) => `${h.epistemicStatus}: ${h.statementHe}`),
      UNKNOWNS_RESOLVED: ds.unknownsResolved.map((u) => `${u.code} (raised ${u.raisedBy.contextId} → resolved ${u.resolvedBy.contextId})`),
      UNKNOWNS_REMAINING: ds.unknownsRemaining.map((u) => `${u.code}: ${u.statementHe}`),
      ACTIONS: r.actions,
      SKIPPED: r.skipped,
    }, null, 2));
  }

  const after = { partner_owner_context: await count("partner_owner_context"), partner_feedback: await count("partner_feedback"), baselineSavedAt: (await loadPartnerBaseline())?.savedAt };
  console.log(`\nsafety: before ${JSON.stringify(before)} | after ${JSON.stringify(after)} | blocked writes ${blocked.length}`);
  if (blocked.length || JSON.stringify(before) !== JSON.stringify(after)) process.exit(2);
}
main().catch((e) => { console.error(e); process.exit(1); });
