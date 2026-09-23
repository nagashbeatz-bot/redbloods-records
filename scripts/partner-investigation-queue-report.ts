/**
 * Partner Investigation Attention Queue — SHADOW MODE simulation (Phase F.1D).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-investigation-queue-report.ts
 *
 * READ-ONLY, same scaffold as scripts/partner-investigation-report.ts: fetch
 * guarded to GET/HEAD against the Supabase host only; the baseline is loaded
 * with a plain SELECT and never saved; no Owner Context exists yet (none is
 * persisted), so every question is UNANSWERED. partner_feedback row count
 * and baseline savedAt are checked before and after. Output is ids / types /
 * factor codes only — no names, notes or contact data.
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

const count = (xs: string[]) => xs.reduce<Record<string, number>>((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {});
const fmt = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)";

async function main() {
  const { supabase } = await import("../lib/supabase");
  const { buildPartnerCompanyState } = await import("../lib/partner/eyes/build");
  const { buildPartnerCases } = await import("../lib/partner/cases/engine");
  const { loadPartnerBaseline } = await import("../lib/partner/baseline/store");
  const { buildPartnerChangeSnapshot } = await import("../lib/partner/changes/snapshot");
  const { comparePartnerChangeSnapshots } = await import("../lib/partner/changes/compare");
  const { buildAttentionQueue } = await import("../lib/partner/investigation");

  const fbCount = async () => {
    const { count: n, error } = await supabase.from("partner_feedback").select("id", { count: "exact", head: true });
    if (error) throw new Error(`partner_feedback count failed: ${error.message}`);
    return n;
  };
  const fbBefore = await fbCount();
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

  const projects: Record<string, { status: string; active: boolean; businessType: string; daysSinceUpdate: number | null }> = {};
  for (const p of state.domains.projects.data?.open ?? []) projects[p.id] = { status: p.status, active: p.active, businessType: p.businessType, daysSinceUpdate: p.daysSinceUpdate };
  const releases: Record<string, { labelArtistId: string | null; stage: string }> = {};
  for (const r of state.domains.releasesFull.data?.items ?? []) releases[r.projectId] = { labelArtistId: r.labelArtistId, stage: r.stage };

  const queue = buildAttentionQueue({ cases, projects, releases, contexts: [] });
  const all = [...queue.recommended, ...queue.backlog, ...queue.answered];
  const caseOf = new Map(cases.map((c) => [c.id, c]));

  console.log(`todayIL=${state.todayIL} | Cases=${cases.length} | valid questions=${all.length} | distinct anchors=${new Set(all.map((i) => i.anchor)).size}`);
  console.log(`policy: ${JSON.stringify(queue.policy)}`);
  console.log(`bands: ${fmt(count(all.map((i) => i.band)))}`);
  console.log(`recommended NOW-session: ${queue.recommended.length} | backlog: ${queue.backlog.length} | answered: ${queue.answered.length}`);
  console.log(`backlog by reason: ${fmt(count(queue.backlog.map((i) => i.deferralReason!)))}`);
  console.log(`all by Case type: ${fmt(count(all.map((i) => i.question.caseType)))}`);
  console.log(`recommended by Case type: ${fmt(count(queue.recommended.map((i) => i.question.caseType)))}`);
  console.log(`all by classification: ${fmt(count(all.map((i) => caseOf.get(i.question.caseId)!.classification)))}`);
  console.log(`recommended by classification: ${fmt(count(queue.recommended.map((i) => caseOf.get(i.question.caseId)!.classification)))}`);

  console.log(`diagnostics: ${fmt(count(all.flatMap((i) => i.diagnostics)))}`);

  console.log("\n── Recommended (in order) — WHY_RECOMMENDED ──");
  for (const i of queue.recommended) {
    console.log(`#${i.rank} [${i.band}] ${i.question.id}`);
    console.log(`   anchor=${i.anchor} | equivalence=${i.equivalenceKey}${i.diagnostics.length ? ` | ${i.diagnostics.join(",")}` : ""}`);
    console.log(`   WHY_RECOMMENDED: ${i.explanation.join(", ")}`);
    console.log(`   evidence: ${i.factors.filter((f) => f.effect === "RAISES").map((f) => `${f.code} (${f.basis})`).join("; ") || "(none)"}`);
    console.log(`   Q: ${i.question.questionTextHe}`);
    for (const s of queue.backlog.filter((b) => b.anchor === i.anchor)) console.log(`   same anchor, deferred: ${s.question.id} [${s.band}] (${s.deferralReason})`);
  }

  console.log("\n── Strong (NOW) items not recommended — WHY_DEFERRED ──");
  for (const i of queue.backlog.filter((b) => b.band === "NOW")) {
    console.log(`#${i.rank} ${i.question.id} | ${i.explanation.join(", ")}${i.representedBy ? ` | represented by ${i.representedBy}` : ""}${i.diagnostics.length ? ` | ${i.diagnostics.join(",")}` : ""}`);
  }

  const fbAfter = await fbCount();
  const baselineAfter = await loadPartnerBaseline();
  console.log(`\nsafety: partner_feedback ${fbBefore}→${fbAfter} | baseline savedAt ${baseline?.savedAt}→${baselineAfter?.savedAt} | blocked writes=${blocked.length}`);
  if (blocked.length || fbBefore !== fbAfter || baseline?.savedAt !== baselineAfter?.savedAt) process.exit(2);
}
main().catch((e) => { console.error(e); process.exit(1); });
