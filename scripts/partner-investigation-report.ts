/**
 * Partner Investigation — SHADOW MODE production report (Phase F.1C).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-investigation-report.ts
 *
 * READ-ONLY. Builds the current Cases exactly like scripts/partner-case-report.ts
 * (loadPartnerBaseline() is a plain SELECT; comparePartnerChangeSnapshots()
 * is pure — the baseline is never saved), then runs the PURE investigation
 * model over them. No answer is written, no partner_feedback row is
 * inserted, nothing is surfaced anywhere else.
 *
 * Safety scaffold: fetch guarded to GET/HEAD against the Supabase host
 * only — any write attempt throws and fails the run loudly. Question texts
 * contain only numbers from the Case (no names / notes / contact data).
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

function count(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}
const fmt = (rec: Record<string, number>) => Object.entries(rec).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)";

async function main() {
  const { supabase } = await import("../lib/supabase");
  const { buildPartnerCompanyState } = await import("../lib/partner/eyes/build");
  const { buildPartnerCases } = await import("../lib/partner/cases/engine");
  const { loadPartnerBaseline } = await import("../lib/partner/baseline/store");
  const { buildPartnerChangeSnapshot } = await import("../lib/partner/changes/snapshot");
  const { comparePartnerChangeSnapshots } = await import("../lib/partner/changes/compare");
  const { decideInvestigations } = await import("../lib/partner/investigation");

  const feedbackCount = async () => {
    const { count: n, error } = await supabase.from("partner_feedback").select("id", { count: "exact", head: true });
    if (error) throw new Error(`partner_feedback count failed: ${error.message}`);
    return n;
  };

  console.log("── 0. Safety (before) ──");
  const fbBefore = await feedbackCount();
  const baselineBefore = await loadPartnerBaseline();
  console.log(`  partner_feedback rows=${fbBefore} | baseline savedAt=${baselineBefore?.savedAt ?? "(none)"}`);

  console.log("\n── 1. Build current Cases (read-only, baseline NOT saved) ──");
  const state = await buildPartnerCompanyState();
  let changes: Awaited<ReturnType<typeof comparePartnerChangeSnapshots>>["changes"] = [];
  let changeContext: { previousCapturedAt: string | null; currentCapturedAt: string } | null = null;
  if (baselineBefore) {
    const cmp = comparePartnerChangeSnapshots(baselineBefore.snapshot, buildPartnerChangeSnapshot(state));
    changes = cmp.changes;
    changeContext = { previousCapturedAt: cmp.previousCapturedAt, currentCapturedAt: cmp.currentCapturedAt };
  }
  const cases = buildPartnerCases({ state, today: state.todayIL, changes, changeContext });
  console.log(`  todayIL=${state.todayIL} | Cases=${cases.length}`);

  console.log("\n── 2. Investigation decisions (pure) ──");
  const decisions = decideInvestigations(cases);
  const asked = decisions.filter((d) => d.question);
  const notAsked = decisions.filter((d) => !d.question);
  console.log(`  Cases needing investigation: ${asked.length}/${cases.length}`);
  console.log(`  Cases NOT needing investigation: ${notAsked.length}/${cases.length}`);
  console.log(`  Questions by type: ${fmt(count(asked.map((d) => d.question!.questionType)))}`);
  console.log(`  Questions by Case type: ${fmt(count(asked.map((d) => d.caseType)))}`);
  console.log(`  Questions by subject type: ${fmt(count(asked.map((d) => d.question!.subjectType)))}`);
  console.log(`  Questions with structured answer options (>1 option besides OTHER): ${asked.filter((d) => d.question!.answerOptions.length > 1).length}/${asked.length}`);
  console.log(`  Distinct subjects asked about: ${new Set(asked.map((d) => `${d.question!.subjectType}:${d.question!.subjectId}`)).size}`);
  // Informational only — no threshold is applied. How many questions come from a Case whose age (days late / overdue / since delivery) is 0-1 days.
  const ageOf = (caseId: string) => {
    const c = cases.find((x) => x.id === caseId);
    const v = c?.derivedFacts.find((d) => ["days_late", "days_overdue", "days_since_delivery"].includes(d.id))?.value;
    return typeof v === "number" ? v : null;
  };
  console.log(`  Questions whose Case age is 0-1 days (informational, no threshold applied): ${asked.filter((d) => { const a = ageOf(d.caseId); return a !== null && a <= 1; }).length}/${asked.length}`);
  console.log(`  No-question reasons: ${fmt(count(notAsked.map((d) => d.noQuestionReason!)))}`);
  console.log(`  No-question by Case type: ${fmt(count(notAsked.map((d) => `${d.caseType}(${d.noQuestionReason})`)))}`);

  console.log("\n── 3. Distinct question wordings (texts carry only numbers from the Case) ──");
  const seenType = new Set<string>();
  for (const d of asked) {
    const key = `${d.caseType}:${d.question!.questionType}`;
    if (seenType.has(key)) continue;
    seenType.add(key);
    console.log(`  [${d.caseType} → ${d.question!.questionType}] ${d.question!.id}`);
    console.log(`    Q: ${d.question!.questionTextHe}`);
    console.log(`    answers: ${d.question!.answerOptions.map((o) => o.code).join(" | ")}`);
  }

  console.log("\n── 0. Safety (after) ──");
  const fbAfter = await feedbackCount();
  const baselineAfter = await loadPartnerBaseline();
  console.log(`  partner_feedback rows=${fbAfter} | baseline savedAt=${baselineAfter?.savedAt ?? "(none)"}`);
  console.log(`  partner_feedback unchanged: ${fbBefore === fbAfter} | baseline unchanged: ${baselineBefore?.savedAt === baselineAfter?.savedAt}`);
  console.log(`  blocked write attempts: ${blocked.length}`);
  if (blocked.length || fbBefore !== fbAfter || baselineBefore?.savedAt !== baselineAfter?.savedAt) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
