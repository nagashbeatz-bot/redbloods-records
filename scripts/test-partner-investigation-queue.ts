/**
 * Golden tests for the Partner Investigation Attention Queue (Phase F.1D,
 * SHADOW MODE).
 *
 * Run with:   npx tsx scripts/test-partner-investigation-queue.ts
 *
 * Pure: no Supabase, no network, no LLM, no persistence. Fixtures mirror
 * real production Case shapes.
 */
import fs from "node:fs";
import path from "node:path";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import { CHARTER_ITEMS } from "../lib/partner";
import {
  buildAttentionQueue, buildOwnerContext, decideInvestigation, DEFAULT_ATTENTION_POLICY,
  type AttentionProjectInfo, type AttentionQueue,
} from "../lib/partner/investigation";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

function base(o: Partial<PartnerCase>): PartnerCase {
  return {
    id: "x:1", schemaVersion: CASE_SCHEMA_VERSION, caseType: "X", subjectType: "project", subjectId: "1",
    classification: "RISK", status: "OPEN", createdFrom: "STATE", facts: [], derivedFacts: [], hypotheses: [],
    ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
    interventionStyle: "GENTLE", summaryHe: "", changeContext: null, ...o,
  };
}
const projectDeadline = (pid: string, late = 71) => base({
  id: `project_deadline_passed:${pid}`, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: pid,
  facts: [{ domain: "projects", entityId: pid, field: "deadline", value: "2026-07-14", label: "deadline" }, { domain: "projects", entityId: pid, field: "status", value: "במיקס", label: "status" }],
  derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: late, basis: "x" }],
});
const financeConfig = (pid: string) => base({
  id: `finance_configuration_missing:${pid}`, caseType: "FINANCE_CONFIGURATION_MISSING", classification: "INFORMATION", status: "NEEDS_CONTEXT", subjectId: pid,
  facts: [{ domain: "projects", entityId: pid, field: "hasFinanceSetting", value: false, label: "hasFinanceSetting" }],
});
const stevenDeadline = (id: string, pid: string) => base({
  id: `steven_internal_deadline_passed:${id}`, caseType: "STEVEN_INTERNAL_DEADLINE_PASSED", subjectType: "stevenWork", subjectId: id,
  facts: [{ domain: "steven", entityId: id, field: "internalDeadline", value: "2026-09-21", label: "internalDeadline" }, { domain: "steven", entityId: id, field: "projectId", value: pid, label: "projectId" }],
  derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: 2, basis: "x" }], ownerRulesApplied: ["INTERNAL_DEADLINES_MATTER"],
});
const victorDeadline = (id: string, pid: string | null) => base({
  id: `missed_internal_deadline:${id}`, caseType: "MISSED_INTERNAL_DEADLINE", subjectType: "victorWork", subjectId: id,
  facts: [{ domain: "victor", entityId: id, field: "internalDeadline", value: "2026-09-17", label: "internalDeadline" }, { domain: "victor", entityId: id, field: "projectId", value: pid, label: "projectId" }],
  derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: 6, basis: "x" }], ownerRulesApplied: ["INTERNAL_DEADLINES_MATTER"],
});
const delivery = (id: string, pid: string | null, since = 4) => base({
  id: `victor_delivery_no_followup:${id}`, caseType: "DELIVERY_WITHOUT_RECORDED_FOLLOWUP", classification: "ATTENTION", subjectType: "victorWork", subjectId: id,
  facts: [{ domain: "victor", entityId: id, field: "lastUploadAt", value: "2026-09-19T14:29:35.030Z", label: "lastUploadAt" }, { domain: "victor", entityId: id, field: "projectId", value: pid, label: "projectId" }],
  derivedFacts: [{ id: "days_since_delivery", label: "ימים מאז המסירה", value: since, basis: "x" }],
});
const task = (id: string, overdue: number, pid: string | null = null) => base({
  id: `task_due_date_passed:${id}`, caseType: "TASK_DUE_DATE_PASSED", subjectType: "task", subjectId: id,
  facts: [{ domain: "tasks", entityId: id, field: "dueYmd", value: "2026-06-01", label: "dueYmd" }, { domain: "tasks", entityId: id, field: "projectId", value: pid, label: "projectId" }],
  derivedFacts: [{ id: "days_overdue", label: "ימים באיחור", value: overdue, basis: "x" }],
});
const payment = (pid: string) => base({ id: `project_payment_outstanding:${pid}`, caseType: "PROJECT_PAYMENT_OUTSTANDING", classification: "ATTENTION", subjectId: pid });
const P = (o: Partial<AttentionProjectInfo> = {}): AttentionProjectInfo => ({ status: "בעבודה", active: true, businessType: "לקוח", daysSinceUpdate: 1, ...o });
const recIds = (q: AttentionQueue) => q.recommended.map((i) => i.question.caseId);
const factorCodes = (q: AttentionQueue, caseId: string) => [...q.recommended, ...q.backlog, ...q.answered].find((i) => i.question.caseId === caseId)!.factors.map((f) => f.code);

console.log("1. At most 5 recommended (default policy is a working product policy, not Charter)");
{
  const cases = Array.from({ length: 12 }, (_, n) => projectDeadline(`p${n}`));
  const projects = Object.fromEntries(cases.map((c) => [c.subjectId, P()]));
  const q = buildAttentionQueue({ cases, projects, policy: { ...DEFAULT_ATTENTION_POLICY, maxPerQuestionType: 99 } });
  check("5 recommended", q.recommended.length, 5);
  check("7 in backlog (BUDGET_FULL)", q.backlog.map((b) => b.deferralReason), Array(7).fill("BUDGET_FULL"));
  check("default policy", DEFAULT_ATTENTION_POLICY, { maxRecommended: 5, maxPerAnchor: 1, maxPerQuestionType: 2, recentActivityDays: 7, deliveryGraceDays: 2 });
  ok("policy is not a Charter item", !CHARTER_ITEMS.some((i) => /ATTENTION|QUEUE|BUDGET/i.test(i.id)));
  check("policy is configurable", buildAttentionQueue({ cases, projects, policy: { ...DEFAULT_ATTENTION_POLICY, maxRecommended: 3, maxPerQuestionType: 99 } }).recommended.length, 3);
}

console.log("2. One recommended question per subject (anchor); the rest stay in backlog");
{
  // Real shape: "קרוב אלייך" has PROJECT_DEADLINE + FINANCE_CONFIG + a Steven internal deadline.
  const pid = "10d23186";
  const cases = [projectDeadline(pid), financeConfig(pid), stevenDeadline("56c472fd", pid)];
  const q = buildAttentionQueue({ cases, projects: { [pid]: P({ status: "במיקס" }) } });
  check("exactly one recommended for the project", q.recommended.length, 1);
  check("the Steven internal deadline represents it (Owner Rule INTERNAL_DEADLINES_MATTER)", recIds(q), ["steven_internal_deadline_passed:56c472fd"]);
  const pd = q.backlog.find((b) => b.question.caseType === "PROJECT_DEADLINE_PASSED")!;
  check("project deadline deferred + points at the representative", [pd.deferralReason, pd.representedBy], ["ANCHOR_ALREADY_REPRESENTED", "steven_internal_deadline_passed:56c472fd::WHY_INTERNAL_DEADLINE_PASSED"]);
  check("finance config kept in backlog as BACKGROUND", q.backlog.find((b) => b.question.caseType === "FINANCE_CONFIGURATION_MISSING")!.deferralReason, "BACKGROUND_BAND");
  check("nothing lost: 3 questions accounted for", q.recommended.length + q.backlog.length + q.answered.length, 3);

  // No substitution: when the anchor's best question is type-capped, a weaker one on the same anchor is NOT shown instead.
  const cases2 = [victorDeadline("v1", "a"), victorDeadline("v2", "b"), victorDeadline("v3", "c"), delivery("v3", "c")];
  const q2 = buildAttentionQueue({ cases: cases2, projects: { a: P(), b: P(), c: P() } });
  ok("capped representative → its anchor waits; the weaker delivery question is not substituted", !recIds(q2).includes("victor_delivery_no_followup:v3"));
  check("…and is recorded as represented by the capped question", q2.backlog.find((b) => b.question.caseId === "victor_delivery_no_followup:v3")!.representedBy, "missed_internal_deadline:v3::WHY_INTERNAL_DEADLINE_PASSED");
}

console.log("3. RISK can outrank ATTENTION when evidence supports it");
{
  const q = buildAttentionQueue({ cases: [delivery("d1", "a"), projectDeadline("b")], projects: { a: P(), b: P() } });
  check("RISK project deadline ranks above ATTENTION delivery (same activity evidence)", recIds(q), ["project_deadline_passed:b", "victor_delivery_no_followup:d1"]);
  const q2 = buildAttentionQueue({ cases: [delivery("d1", "a"), projectDeadline("b")], projects: { a: P({ businessType: "לייבל" }), b: P({ daysSinceUpdate: 60 }) } });
  check("…but evidence decides: ATTENTION on an active label project outranks a RISK without recent activity", recIds(q2), ["victor_delivery_no_followup:d1", "project_deadline_passed:b"]);
}

console.log("4. Age alone does not create priority (STALE_IS_NOT_AUTOMATICALLY_URGENT)");
{
  const young = task("t-young", 2), old = task("t-old", 300);
  const q = buildAttentionQueue({ cases: [old, young], policy: { ...DEFAULT_ATTENTION_POLICY, maxRecommended: 1 } });
  check("equal evidence → age does not decide (tie broken by questionId)", recIds(q), ["task_due_date_passed:t-old"]);
  const q2 = buildAttentionQueue({ cases: [task("a-300", 300), task("z-2", 2)], policy: { ...DEFAULT_ATTENTION_POLICY, maxRecommended: 1 } });
  check("300-day-old task does not beat a 2-day-old one because of age (id order only)", recIds(q2), ["task_due_date_passed:a-300"]);
  const q3 = buildAttentionQueue({ cases: [task("a-2", 2), task("z-300", 300)], policy: { ...DEFAULT_ATTENTION_POLICY, maxRecommended: 1 } });
  check("…and swapping ids swaps the result: age played no part", recIds(q3), ["task_due_date_passed:a-2"]);
  ok("age is recorded only as a NOTE factor", factorCodes(q, "task_due_date_passed:t-old").includes("AGE_NOT_USED_FOR_PRIORITY") && q.recommended[0].factors.find((f) => f.code === "AGE_NOT_USED_FOR_PRIORITY")!.effect === "NOTE");
  const src = fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/queue.ts"), "utf8");
  ok("ordering code never compares days_late / days_overdue (static)", !/ORDER_FACTORS[\s\S]{0,400}days_(late|overdue)/.test(src) && !/sort\([\s\S]{0,600}days_(late|overdue)/.test(src));
}

console.log("5. Active-project problem outranks a stale standalone task");
{
  const q = buildAttentionQueue({ cases: [task("t1", 90), projectDeadline("p1", 10)], projects: { p1: P() }, policy: { ...DEFAULT_ATTENTION_POLICY, maxRecommended: 1 } });
  check("active project first", recIds(q), ["project_deadline_passed:p1"]);
  check("band NOW vs SOON", [q.recommended[0].band, q.backlog[0].band], ["NOW", "SOON"]);
  ok("standalone task explained", factorCodes(q, "task_due_date_passed:t1").includes("STANDALONE"));
  const paused = buildAttentionQueue({ cases: [projectDeadline("p2")], projects: { p2: P({ active: false, status: "בהשהייה" }) } });
  check("inactive (paused) project → BACKGROUND, not recommended", [paused.recommended.length, paused.backlog[0].band], [0, "BACKGROUND"]);
}

console.log("6. Relevant Owner Rules produce explicit, traceable priority reasons");
{
  const q = buildAttentionQueue({ cases: [victorDeadline("v1", "lbl")], projects: { lbl: P({ businessType: "לייבל" }) } });
  const f = q.recommended[0].factors;
  ok("INTERNAL_DEADLINES_MATTER factor with basis", f.some((x) => x.code === "OWNER_RULE_INTERNAL_DEADLINES_MATTER" && x.effect === "RAISES" && /ownerRulesApplied/.test(x.basis)));
  ok("PROTECT_LABEL_RELEASES factor from explicit businessType", f.some((x) => x.code === "OWNER_RULE_PROTECT_LABEL_RELEASES" && /businessType=לייבל/.test(x.basis)));
  const viaRelease = buildAttentionQueue({ cases: [projectDeadline("r1")], projects: { r1: P({ daysSinceUpdate: 60 }) }, releases: { r1: { labelArtistId: "artist-1", stage: "מיקס" } } });
  ok("PROTECT_LABEL_RELEASES also from an explicit release labelArtistId", viaRelease.recommended[0].factors.some((x) => x.code === "OWNER_RULE_PROTECT_LABEL_RELEASES" && /labelArtistId/.test(x.basis)));
  ok("every RAISES/LOWERS factor carries a basis (no unexplained points)", [...q.recommended, ...viaRelease.recommended].every((i) => i.factors.every((x) => x.basis.length > 0)));
  ok("no numeric score field on items", !("score" in q.recommended[0]));
}

console.log("7. Already-answered current question is not recommended");
{
  const c = projectDeadline("p1");
  const question = decideInvestigation(c).question!;
  const ctx = buildOwnerContext(question, { answerCode: "DEADLINE_NOT_UPDATED", answeredAt: "2026-09-23T12:00:00.000Z" });
  const q = buildAttentionQueue({ cases: [c], projects: { p1: P() }, contexts: [ctx] });
  check("not recommended; ANSWERED_NOT_RESURFACED", [q.recommended.length, q.answered[0].attentionState, q.answered[0].answerState], [0, "ANSWERED_NOT_RESURFACED", "ANSWERED"]);
  const changed = { ...c, facts: c.facts.map((f) => (f.field === "deadline" ? { ...f, value: "2026-08-01" } : f)) };
  const q2 = buildAttentionQueue({ cases: [changed], projects: { p1: P() }, contexts: [ctx] });
  check("facts changed since the answer → resurfaces with an explicit reason", [q2.recommended.length, q2.recommended[0]?.answerState, q2.recommended[0]?.factors.some((f) => f.code === "EVIDENCE_CHANGED_SINCE_ANSWER")], [1, "ANSWERED_EVIDENCE_CHANGED", true]);
  const aged = { ...c, derivedFacts: [{ id: "days_late", label: "x", value: 72, basis: "x" }] };
  check("only derived age changed (one more day) → still answered, not resurfaced", buildAttentionQueue({ cases: [aged], projects: { p1: P() }, contexts: [ctx] }).answered.length, 1);
}

console.log("8. Unanswered questions remain in the backlog (not recommended ≠ resolved)");
{
  const cases = Array.from({ length: 8 }, (_, n) => task(`t${n}`, 10 + n));
  const q = buildAttentionQueue({ cases, policy: { ...DEFAULT_ATTENTION_POLICY, maxPerQuestionType: 99 } });
  check("5 + 3 backlog", [q.recommended.length, q.backlog.length], [5, 3]);
  ok("backlog items are UNANSWERED + NOT_CURRENTLY_RECOMMENDED with a reason", q.backlog.every((b) => b.answerState === "UNANSWERED" && b.attentionState === "NOT_CURRENTLY_RECOMMENDED" && b.deferralReason !== null));
  const q2 = buildAttentionQueue({ cases: [delivery("d0", null, 0)] });
  check("delivery from today → TOO_EARLY_TO_ASK, backlog (BACKGROUND), still UNANSWERED", [q2.backlog[0].band, q2.backlog[0].answerState, q2.backlog[0].factors.some((f) => f.code === "TOO_EARLY_TO_ASK")], ["BACKGROUND", "UNANSWERED", true]);
  check("fact-complete Case (payment) produces no queue item at all", buildAttentionQueue({ cases: [payment("pp")] }).backlog.length, 0);
}

console.log("9/10. Deterministic ordering; same input → same queue");
{
  const cases = [projectDeadline("p1"), task("t1", 40), delivery("d1", "p2"), victorDeadline("v1", "p3"), financeConfig("p1"), stevenDeadline("s1", "p4")];
  const projects = { p1: P(), p2: P({ daysSinceUpdate: 3 }), p3: P(), p4: P({ daysSinceUpdate: 30 }) };
  const a = buildAttentionQueue({ cases, projects }), b = buildAttentionQueue({ cases: [...cases].reverse(), projects });
  check("same queue regardless of input order", JSON.stringify(a), JSON.stringify(b));
  check("same input twice → identical", JSON.stringify(buildAttentionQueue({ cases, projects })), JSON.stringify(a));
  check("ranks are 1..n without gaps", [...a.recommended, ...a.backlog, ...a.answered].map((i) => i.rank).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);
}

console.log("11-14. No AI, no mutation, no baseline / feedback write (static + runtime)");
{
  const cases = [projectDeadline("p1"), task("t1", 40)];
  const before = JSON.stringify(cases);
  buildAttentionQueue({ cases, projects: { p1: P() } });
  ok("12. input Cases unchanged", JSON.stringify(cases) === before);
  ok("12. Charter unchanged", CHARTER_ITEMS.every((i) => i.id !== "ATTENTION_BUDGET"));
  const src = fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/queue.ts"), "utf8");
  ok("11. no LLM / network import", !/openai|anthropic|fetch\(|lib\/mai/.test(src));
  ok("13. no baseline import / write", !/partner\/baseline|savePartnerBaseline|partner_change_baseline/.test(src));
  ok("14. no feedback store / DB write", !/feedback\/store|feedback\/persistence|lib\/supabase|\.(insert|update|upsert|delete)\(/.test(src));
  ok("no clock / randomness", !/Date\.now\(|new Date\(\)|Math\.random/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
