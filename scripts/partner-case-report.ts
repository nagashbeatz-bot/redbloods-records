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
  const baselineBefore = await loadPartnerBaseline();
  const baseline = baselineBefore;
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

  // ══════════════════════════════════════════════════════════════════════════
  // Case catalog audit (§48) — exact catalog, read from the actual case types
  // observed this run cross-checked against the static per-detector table
  // below (hand-verified against lib/partner/cases/detectors/*.ts source).
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Case catalog audit (source of truth: lib/partner/cases/detectors/*.ts) ──");
  const CATALOG: Array<{ caseType: string; source: "STATE" | "CHANGE"; classification: string; statusNote?: string }> = [
    { caseType: "MISSED_INTERNAL_DEADLINE", source: "STATE", classification: "RISK" },
    { caseType: "DELIVERY_WITHOUT_RECORDED_FOLLOWUP", source: "STATE", classification: "ATTENTION" },
    { caseType: "PROJECT_PAYMENT_OUTSTANDING", source: "STATE", classification: "ATTENTION" },
    { caseType: "PROJECT_OVERPAYMENT", source: "STATE", classification: "INFORMATION" },
    { caseType: "FINANCE_CONFIGURATION_MISSING", source: "STATE", classification: "INFORMATION", statusNote: "status=NEEDS_CONTEXT" },
    { caseType: "RELEASE_TARGET_DATE_PASSED", source: "STATE", classification: "RISK" },
    { caseType: "PROJECT_DEADLINE_PASSED", source: "STATE", classification: "RISK" },
    { caseType: "MONEY_RECEIVED", source: "CHANGE", classification: "OPPORTUNITY" },
    { caseType: "NEW_SHOW_RECORDED", source: "CHANGE", classification: "OPPORTUNITY or INFORMATION (depends on show status: אושרה/בוצע → OPPORTUNITY, else INFORMATION)" },
    { caseType: "PROPOSAL_STATUS_CHANGED", source: "CHANGE", classification: "INFORMATION" },
    { caseType: "RELEASE_TARGET_DATE_CHANGED", source: "CHANGE", classification: "INFORMATION" },
  ];
  console.log(`  Exact catalog size: ${CATALOG.length} (${CATALOG.filter((c) => c.source === "STATE").length} STATE + ${CATALOG.filter((c) => c.source === "CHANGE").length} CHANGE) — corrects prior inconsistent "5 STATE + 4 CHANGE" wording`);
  for (const entry of CATALOG) {
    const seenCount = cases.filter((c) => c.caseType === entry.caseType).length;
    console.log(`  ${entry.caseType} | source=${entry.source} | classification=${entry.classification}${entry.statusNote ? ` | ${entry.statusNote}` : ""} | seen this run=${seenCount}`);
  }
  const unexpectedTypes = [...new Set(cases.map((c) => c.caseType))].filter((t) => !CATALOG.some((e) => e.caseType === t));
  console.log(`  Unexpected case types not in the catalog table above: ${unexpectedTypes.length ? unexpectedTypes.join(", ") : "(none)"}`);

  // ══════════════════════════════════════════════════════════════════════════
  // Owner Rule traceability (§49) — only report a rule as "applied" if it is
  // genuinely attached to >=1 Case this run; STALE_IS_NOT_AUTOMATICALLY_URGENT
  // is NOT encoded as an ownerRulesApplied id anywhere in the E.1 detectors
  // (confirmed by source read) — it is honored structurally (no age-based
  // severity escalation exists to disable), never claimed as "applied".
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Owner Rule traceability (§49) ──");
  console.log(`  INTERNAL_DEADLINES_MATTER applied to ${ruleUse["INTERNAL_DEADLINES_MATTER"] ?? 0} Case(s) (MISSED_INTERNAL_DEADLINE only)`);
  console.log(`  PROTECT_LABEL_RELEASES applied to ${ruleUse["PROTECT_LABEL_RELEASES"] ?? 0} Case(s) (RELEASE_TARGET_DATE_PASSED + RELEASE_TARGET_DATE_CHANGED)`);
  console.log(`  STALE_IS_NOT_AUTOMATICALLY_URGENT: NOT present in any ownerRulesApplied array in the E.1 catalog (structural default only — never claimed "applied" in code)`);

  // ══════════════════════════════════════════════════════════════════════════
  // Finance false-positive check (§62, the exact bug this hardening block
  // fixes): every PROJECT_OVERPAYMENT / PROJECT_PAYMENT_OUTSTANDING must be
  // derivable from agreedPrice vs received ALONE — never from balance_legacy.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Finance Case correctness check (agreedPrice vs received only, cancelled excluded from the decision) ──");
  {
    const financeCases = cases.filter((c) => c.caseType === "PROJECT_PAYMENT_OUTSTANDING" || c.caseType === "PROJECT_OVERPAYMENT");
    const getFact = (c: (typeof cases)[number], field: string) => c.facts.find((f) => f.field === field)?.value as number | undefined;
    let bad = 0;
    for (const c of financeCases) {
      const agreed = getFact(c, "agreedPrice") ?? 0, received = getFact(c, "received") ?? 0;
      const outstanding = c.derivedFacts.find((d) => d.id === "outstanding")?.value as number | undefined;
      const overpayment = c.derivedFacts.find((d) => d.id === "overpayment")?.value as number | undefined;
      const ok = c.caseType === "PROJECT_PAYMENT_OUTSTANDING" ? outstanding === agreed - received : overpayment === received - agreed;
      if (!ok) { bad++; console.log(`  MISMATCH: ${c.id} — agreed=${agreed} received=${received} outstanding=${outstanding} overpayment=${overpayment}`); }
    }
    console.log(`  ${financeCases.length} finance Cases checked, ${bad} mismatches (must be 0)`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Victor follow-up calibration (§41-43) — informational only. Buckets
  // mirror the detector's own filter (ball.holder==="owner" && lastUploadAt)
  // exactly — no new threshold or severity logic is introduced here.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Victor follow-up (DELIVERY_WITHOUT_RECORDED_FOLLOWUP) calibration ──");
  if (state.domains.victor.status === "AVAILABLE" && state.domains.victor.data) {
    const ownerItems = state.domains.victor.data.active.filter((w) => w.ball.holder === "owner" && w.lastUploadAt);
    const ages = ownerItems.map((w) => w.waitingOwnerDays ?? 0).sort((a, b) => a - b);
    const bucket = (lo: number, hi: number) => ages.filter((a) => a >= lo && a <= hi).length;
    console.log(`  total: ${ownerItems.length}`);
    console.log(`  0-2 days: ${bucket(0, 2)} | 3-6 days: ${bucket(3, 6)} | 7-13 days: ${bucket(7, 13)} | 14-29 days: ${bucket(14, 29)} | 30+ days: ${ages.filter((a) => a >= 30).length}`);
    console.log(`  newest age: ${ages[0] ?? "(none)"} | oldest age: ${ages[ages.length - 1] ?? "(none)"} | median age: ${ages.length ? ages[Math.floor(ages.length / 2)] : "(none)"}`);
    console.log(`  linked to a project: ${ownerItems.filter((w) => w.projectId !== null).length} | standalone (no projectId): ${ownerItems.filter((w) => w.projectId === null).length}`);
    console.log(`  never had ANY recorded review event (reviewEvents.length === 0): ${ownerItems.filter((w) => w.reviewEvents.length === 0).length}`);
    console.log(`  detector definition confirmed: ball.holder==="owner" (lib/coo/victor-ball.ts) means the latest RECORDED action is Victor's upload with no later recorded owner notes/review — never re-derived here, read verbatim from the same field the Case Engine uses.`);
  } else {
    console.log("  victor domain unavailable this run — skipped.");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Project deadline calibration (§44-45) — informational only.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── Project deadline (PROJECT_DEADLINE_PASSED) calibration ──");
  if (state.domains.projects.status === "AVAILABLE" && state.domains.projects.data) {
    const passed = state.domains.projects.data.open.filter((p) => p.deadline.ymd && p.deadline.ymd < state.todayIL);
    const daysLateOf = (p: (typeof passed)[number]) => (p.deadline.daysTo !== null ? -p.deadline.daysTo : null);
    const withDays = passed.map((p) => ({ p, daysLate: daysLateOf(p) })).filter((x): x is { p: (typeof passed)[number]; daysLate: number } => x.daysLate !== null);
    const bucket = (lo: number, hi: number) => withDays.filter((x) => x.daysLate >= lo && x.daysLate <= hi).length;
    console.log(`  total PROJECT_DEADLINE_PASSED subjects: ${passed.length} (days-late known for ${withDays.length})`);
    console.log(`  1-3: ${bucket(1, 3)} | 4-7: ${bucket(4, 7)} | 8-14: ${bucket(8, 14)} | 15-30: ${bucket(15, 30)} | 31-60: ${bucket(31, 60)} | 60+: ${withDays.filter((x) => x.daysLate > 60).length}`);
    const statusDist: Record<string, number> = {};
    for (const p of passed) statusDist[p.status] = (statusDist[p.status] ?? 0) + 1;
    console.log(`  status distribution: ${fmt(statusDist)}`);
    console.log(`  completed/cancelled exclusion: structural — these come from domains.projects.data.open, lib/coo's own active-only set (ProjectFact.active===true), never re-filtered here.`);
    const touchedAfterDeadline = withDays.filter((x) => x.p.daysSinceUpdate !== null && x.p.daysSinceUpdate < x.daysLate);
    console.log(`  projects touched (updated) AFTER their deadline passed (daysSinceUpdate < daysLate — a proxy, not a claim of what changed): ${touchedAfterDeadline.length}/${withDays.length}`);
    console.log(`  NOTE: this does NOT conclude stale data for old deadlines — reported as raw counts only, per Owner instruction §44.`);
  } else {
    console.log("  projects domain unavailable this run — skipped.");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINANCE_CONFIGURATION_MISSING breakdown (§46-47) — counts only, no
  // inference about why a price is missing.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── FINANCE_CONFIGURATION_MISSING breakdown ──");
  if (state.domains.projects.status === "AVAILABLE" && state.domains.projects.data) {
    const missing = state.domains.projects.data.open.filter((p) => !p.hasFinanceSetting);
    const byType: Record<string, number> = {}, byStatus: Record<string, number> = {};
    for (const p of missing) { byType[p.projectType] = (byType[p.projectType] ?? 0) + 1; byStatus[p.status] = (byStatus[p.status] ?? 0) + 1; }
    console.log(`  total: ${missing.length}`);
    console.log(`  by projectType: ${fmt(byType)}`);
    console.log(`  by status: ${fmt(byStatus)}`);
  } else {
    console.log("  projects domain unavailable this run — skipped.");
  }

  console.log(`\nblocked requests during this run: ${blocked.length} (must be 0 — this script must never write)`);

  console.log("\n── Baseline immutability check (§54) — re-reading partner_change_baseline.savedAt now ──");
  const baselineAfter = await loadPartnerBaseline();
  console.log(`  savedAt before: ${baselineBefore?.savedAt ?? "(no baseline)"}`);
  console.log(`  savedAt after:  ${baselineAfter?.savedAt ?? "(no baseline)"}`);
  console.log(`  unchanged: ${(baselineBefore?.savedAt ?? null) === (baselineAfter?.savedAt ?? null)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[partner-case-report] failed:", e instanceof Error ? e.message : e); process.exit(1); });
