/**
 * Partner Structured Owner Feedback — SHADOW MODE production report (Phase F.1).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/partner-feedback-report.ts
 *
 * READ-ONLY. Builds the current production Case catalog (STATE only —
 * deliberately never touches partner_change_baseline at all, not even a
 * read: this report has no need for CHANGE cases, so it takes the simplest
 * safe path rather than reusing scripts/partner-case-report.ts's baseline
 * read+compare). No feedback is written anywhere — the small feedback set
 * below is synthetic, in-memory only, built to exercise the model against
 * REAL production Case ids/snapshots without ever persisting anything
 * (persistence does not exist yet — see the Phase F.1 report's DB Gate).
 *
 * Safety scaffold: only SUPABASE_URL + SUPABASE_SECRET_KEY read from
 * .env.local; fetch guarded to GET/HEAD against the Supabase host only.
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

function fmt(rec: Record<string, number>): string {
  return Object.entries(rec).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)";
}

async function main() {
  const { buildPartnerCompanyState } = await import("../lib/partner/eyes/build");
  const { buildPartnerCases } = await import("../lib/partner/cases/engine");
  const { CASE_SCHEMA_VERSION } = await import("../lib/partner/cases/types");
  const {
    buildCaseFeedbackSnapshot, validatePartnerFeedback, summarizePartnerFeedback,
    deriveLearningSignals, buildLearningProposals, emptyFeedbackDimensions,
  } = await import("../lib/partner/feedback");
  type PartnerFeedback = import("../lib/partner/feedback").PartnerFeedback;

  console.log("── 1. Build current production state + STATE Cases (read-only, no baseline touched) ──");
  const state = await buildPartnerCompanyState();
  const cases = buildPartnerCases({ state, today: state.todayIL }); // no `changes` passed -> STATE only, no baseline read at all
  console.log(`  capturedAt=${state.capturedAt} todayIL=${state.todayIL}`);
  console.log(`  Total Cases: ${cases.length}`);
  console.log(`  By type: ${fmt(cases.reduce<Record<string, number>>((a, c) => { a[c.caseType] = (a[c.caseType] ?? 0) + 1; return a; }, {}))}`);

  // ══════════════════════════════════════════════════════════════════════════
  // §58 — targetability: every Case must have enough stable identity to
  // receive instance feedback (non-empty id/caseType/subjectType/subjectId).
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Targetability (§58) ──");
  const targetable = cases.filter((c) => !!c.id && !!c.caseType && !!c.subjectType && !!c.subjectId);
  console.log(`  targetable Cases / total Cases: ${targetable.length}/${cases.length} (${cases.length ? Math.round((targetable.length / cases.length) * 100) : 100}%)`);
  if (targetable.length !== cases.length) {
    const gaps = cases.filter((c) => !targetable.includes(c));
    console.log(`  GAP — ${gaps.length} Case(s) missing stable identity: ${gaps.map((c) => c.id || "(no id)").join(", ")}`);
  } else {
    console.log("  no gaps — every Case is instance-feedback-ready.");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §59 — detector/schema version audit.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Detector/schema version audit (§59) ──");
  const withVersion = cases.filter((c) => c.schemaVersion === CASE_SCHEMA_VERSION);
  console.log(`  Cases carrying CASE_SCHEMA_VERSION ("${CASE_SCHEMA_VERSION}"): ${withVersion.length}/${cases.length}`);
  console.log(`  Additive field confirmed safe: Case.id computation is unaffected (id is still \${caseType}:\${subjectId} — verified by the full regression suite, not re-derived here).`);

  // ══════════════════════════════════════════════════════════════════════════
  // §36/§57 — Shadow feedback simulation. Picks REAL production Cases (by
  // type, first match) to exercise CASE_INSTANCE feedback against actual
  // snapshots. Falls back gracefully (skips) when a given type has 0 Cases
  // this run — never fabricates one.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Shadow feedback simulation (synthetic, in-memory only — nothing written) ──");
  const byType = (t: string) => cases.find((c) => c.caseType === t);
  const feedback: PartnerFeedback[] = [];
  const sim = (label: string, caseType: string, build: (c: (typeof cases)[number]) => PartnerFeedback) => {
    const c = byType(caseType);
    if (!c) { console.log(`  [skip] ${label} — no ${caseType} Case exists this run`); return; }
    const fb = build(c);
    const result = validatePartnerFeedback(fb, [...new Set(cases.map((x) => x.caseType))]);
    console.log(`  ${label}: ${c.id} -> valid=${result.valid}${result.warnings.length ? ` warnings=[${result.warnings.join("; ")}]` : ""}`);
    if (result.valid) feedback.push(fb);
  };

  sim("mark one Task Case NOT_IMPORTANT", "TASK_DUE_DATE_PASSED", (c) => ({
    id: "sim-1", createdAt: `${state.todayIL}T09:00:00Z`,
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: { ...emptyFeedbackDimensions(), importance: "NOT_IMPORTANT" },
    note: null, caseSnapshot: buildCaseFeedbackSnapshot(c, `${state.todayIL}T09:00:00Z`), supersedesId: null, provenance: { source: "owner_manual" },
  }));
  sim("mark one Victor follow-up THERE_IS_CONTEXT", "DELIVERY_WITHOUT_RECORDED_FOLLOWUP", (c) => ({
    id: "sim-2", createdAt: `${state.todayIL}T09:00:00Z`,
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: { ...emptyFeedbackDimensions(), context: { value: "HAS_MISSING_CONTEXT", contextCode: "HANDLED_OUTSIDE_REDBLOODS" } },
    note: "בדקתי את זה מחוץ למערכת מול Victor ישירות.", caseSnapshot: buildCaseFeedbackSnapshot(c, `${state.todayIL}T09:00:00Z`), supersedesId: null, provenance: { source: "owner_manual" },
  }));
  sim("mark one project deadline IMPORTANT", "PROJECT_DEADLINE_PASSED", (c) => ({
    id: "sim-3", createdAt: `${state.todayIL}T09:00:00Z`,
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: { ...emptyFeedbackDimensions(), importance: "IMPORTANT" },
    note: null, caseSnapshot: buildCaseFeedbackSnapshot(c, `${state.todayIL}T09:00:00Z`), supersedesId: null, provenance: { source: "owner_manual" },
  }));
  sim("mark one hypothetical inference DO_NOT_INFER", "DELIVERY_WITHOUT_RECORDED_FOLLOWUP", (c) => {
    const hypothesisId = c.hypotheses[0]?.id ?? "may_be_pending_review";
    return {
      id: "sim-4", createdAt: `${state.todayIL}T09:00:00Z`,
      target: { scope: "HYPOTHESIS", caseId: c.id, caseType: c.caseType, hypothesisId },
      dimensions: { ...emptyFeedbackDimensions(), inference: { value: "DO_NOT_INFER", hypothesisId } },
      note: null, caseSnapshot: buildCaseFeedbackSnapshot(c, `${state.todayIL}T09:00:00Z`), supersedesId: null, provenance: { source: "owner_manual" },
    };
  });
  // A few repeats of the SAME dimension on additional real instances, so the
  // learning-signal section below has something non-trivial to show.
  const additionalTaskCases = cases.filter((c) => c.caseType === "TASK_DUE_DATE_PASSED").slice(1, 4);
  additionalTaskCases.forEach((c, i) => {
    feedback.push({
      id: `sim-extra-${i}`, createdAt: `${state.todayIL}T09:00:00Z`,
      target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
      dimensions: { ...emptyFeedbackDimensions(), importance: "NOT_IMPORTANT" },
      note: null, caseSnapshot: buildCaseFeedbackSnapshot(c, `${state.todayIL}T09:00:00Z`), supersedesId: null, provenance: { source: "owner_manual" },
    });
  });
  if (additionalTaskCases.length) console.log(`  (+${additionalTaskCases.length} additional real TASK_DUE_DATE_PASSED instances also marked NOT_IMPORTANT, to demonstrate the learning-signal layer below)`);

  console.log(`\n  Total synthetic feedback recorded this run: ${feedback.length}`);

  // ══════════════════════════════════════════════════════════════════════════
  // Deterministic summary + learning signals + proposals.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Feedback summary (by CaseType) ──");
  const summary = summarizePartnerFeedback(feedback);
  for (const s of summary) {
    console.log(`  ${s.caseType}: total=${s.totalFeedback}`);
    console.log(`    accuracy: ${fmt(s.counts.accuracy)} | importance: ${fmt(s.counts.importance)} | timing: ${fmt(s.counts.timing)}`);
    console.log(`    context: ${fmt(s.counts.context)} | inference: ${fmt(s.counts.inference)} | override: ${fmt(s.counts.override)}`);
  }

  console.log("\n── Learning signals (unconditional, counts only) ──");
  const signals = deriveLearningSignals(feedback);
  for (const s of signals) console.log(`  ${s.id} | sampleSize=${s.sampleSize}/${s.totalReviewedForCaseType}`);

  console.log("\n── Learning proposals (sampleSize>=2 only — PROPOSED, never applied) ──");
  const proposals = buildLearningProposals(signals);
  if (proposals.length === 0) console.log("  (none this run — no repeated pattern reached sampleSize>=2)");
  for (const p of proposals) console.log(`  [${p.status}] ${p.evidenceSummary}`);

  console.log(`\nblocked requests during this run: ${blocked.length} (must be 0 — this script must never write)`);
  console.log("partner_change_baseline: never read, never touched by this script (STATE-only build — no CHANGE cases requested).");
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-feedback-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
