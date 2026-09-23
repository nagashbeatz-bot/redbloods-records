/**
 * Golden tests for the Partner Investigation Attention Queue (Phase F.1D +
 * decision-value correction, SHADOW MODE).
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
  type AttentionProjectInfo, type AttentionQueue, type AttentionItem,
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
const victorDeadline = (id: string, pid: string | null, late = 6) => base({
  id: `missed_internal_deadline:${id}`, caseType: "MISSED_INTERNAL_DEADLINE", subjectType: "victorWork", subjectId: id,
  facts: [{ domain: "victor", entityId: id, field: "internalDeadline", value: "2026-09-17", label: "internalDeadline" }, { domain: "victor", entityId: id, field: "projectId", value: pid, label: "projectId" }],
  derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: late, basis: "x" }], ownerRulesApplied: ["INTERNAL_DEADLINES_MATTER"],
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
const all = (q: AttentionQueue): AttentionItem[] => [...q.recommended, ...q.backlog, ...q.answered];
const item = (q: AttentionQueue, caseId: string) => all(q).find((i) => i.question.caseId === caseId)!;
const rankOf = (q: AttentionQueue, caseId: string) => item(q, caseId).rank;
/** n NOW-band internal-deadline questions on distinct active+recent projects (business-equivalent). */
const internalDeadlines = (n: number, prefix = "v") => {
  const cases = Array.from({ length: n }, (_, i) => victorDeadline(`${prefix}${i}`, `${prefix}p${i}`));
  const projects = Object.fromEntries(cases.map((_, i) => [`${prefix}p${i}`, P()]));
  return { cases, projects };
};

console.log("C1. maxRecommended is a CEILING, not a quota");
{
  const { cases, projects } = internalDeadlines(2);
  const q = buildAttentionQueue({ cases: [...cases, task("t1", 40), task("t2", 50), financeConfig("fp"), delivery("d1", null, 9)], projects });
  check("only the 2 decision-useful NOW questions are recommended (no filler)", recIds(q), ["missed_internal_deadline:v0", "missed_internal_deadline:v1"]);
  check("default policy (no type cap; floor = NOW)", DEFAULT_ATTENTION_POLICY, { maxRecommended: 5, maxPerAnchor: 1, recommendationFloor: ["NOW"], recentActivityDays: 7, deliveryGraceDays: 2 });
  ok("policy is not a Charter item", !CHARTER_ITEMS.some((i) => /ATTENTION|QUEUE|BUDGET|FLOOR/i.test(i.id)));
  check("empty input → empty recommendation", buildAttentionQueue({ cases: [] }).recommended, []);
}

console.log("C2. 3 strong items → exactly 3 recommended");
{
  const { cases, projects } = internalDeadlines(3);
  check("3", buildAttentionQueue({ cases, projects }).recommended.length, 3);
}

console.log("C3. BACKGROUND never fills spare capacity");
{
  const q = buildAttentionQueue({ cases: [financeConfig("a"), financeConfig("b"), delivery("d0", null, 0), projectDeadline("paused")], projects: { a: P(), b: P(), paused: P({ active: false, status: "בהשהייה" }) } });
  check("nothing recommended", q.recommended.length, 0);
  check("all BACKGROUND, deferred as LOWER_PRIORITY_BAND", q.backlog.map((b) => [b.band, b.deferralReason]), Array(4).fill(["BACKGROUND", "LOWER_PRIORITY_BAND"]));
}

console.log("C4. SOON does not automatically fill spare capacity");
{
  const { cases, projects } = internalDeadlines(1);
  const soon = [task("t1", 30), task("t2", 90), delivery("d1", null, 9), projectDeadline("stale")];
  const q = buildAttentionQueue({ cases: [...cases, ...soon], projects: { ...projects, stale: P({ daysSinceUpdate: 60 }) } });
  check("1 NOW recommended, 4 SOON stay in backlog", [q.recommended.length, q.backlog.filter((b) => b.band === "SOON").map((b) => b.deferralReason)], [1, Array(4).fill("LOWER_PRIORITY_BAND")]);
  const withSoon = buildAttentionQueue({ cases: soon, projects: { stale: P({ daysSinceUpdate: 60 }) }, policy: { ...DEFAULT_ATTENTION_POLICY, recommendationFloor: ["NOW", "SOON"] } });
  ok("SOON is recommended only through an explicit, documented floor change", withSoon.recommended.length > 0 && withSoon.recommended.every((r) => r.explanation.includes("WITHIN_RECOMMENDATION_FLOOR_SOON")));
}

console.log("C5. A stronger 3rd question of the same type beats a weaker question of a different type");
{
  const { cases, projects } = internalDeadlines(3);
  const q = buildAttentionQueue({ cases: [...cases, projectDeadline("pd")], projects: { ...projects, pd: P() }, policy: { ...DEFAULT_ATTENTION_POLICY, maxRecommended: 3 } });
  check("all 3 internal deadlines (INTERNAL_DEADLINES_MATTER) are recommended", recIds(q), ["missed_internal_deadline:v0", "missed_internal_deadline:v1", "missed_internal_deadline:v2"]);
  check("the weaker project deadline waits for an evidence reason, not a type reason", item(q, "project_deadline_passed:pd").deferralReason, "MAX_RECOMMENDED_REACHED");
}

console.log("C6. No hard question-type cap exists");
{
  const { cases, projects } = internalDeadlines(5);
  check("5 questions of the same type can all be recommended", buildAttentionQueue({ cases, projects }).recommended.map((r) => r.question.questionType), Array(5).fill("WHY_INTERNAL_DEADLINE_PASSED"));
  const src = fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/queue.ts"), "utf8");
  ok("no maxPerQuestionType / QUESTION_TYPE_CAP anywhere in the queue", !/maxPerQuestionType|QUESTION_TYPE_CAP|perType/.test(src));
}

console.log("C7. Anchor dedupe: one project never takes several slots");
{
  // Real shape: "קרוב אלייך" — PROJECT_DEADLINE + FINANCE_CONFIG + Steven internal deadline.
  const pid = "10d23186";
  const q = buildAttentionQueue({ cases: [projectDeadline(pid), financeConfig(pid), stevenDeadline("56c472fd", pid)], projects: { [pid]: P({ status: "במיקס" }) } });
  check("exactly one recommended — the strongest (Steven, INTERNAL_DEADLINES_MATTER)", recIds(q), ["steven_internal_deadline_passed:56c472fd"]);
  check("both others deferred as ANCHOR_ALREADY_REPRESENTED → Steven question", all(q).filter((i) => i.deferralReason === "ANCHOR_ALREADY_REPRESENTED").map((i) => i.representedBy), Array(2).fill("steven_internal_deadline_passed:56c472fd::WHY_INTERNAL_DEADLINE_PASSED"));
  check("nothing lost: 3 questions accounted for", all(q).length, 3);
}

console.log("C8. A weaker same-anchor question never substitutes");
{
  // Anchor c's best question (internal deadline) does not fit whole with its equivalents → the weaker delivery on c is NOT shown instead.
  const { cases, projects } = internalDeadlines(3, "c");
  const q = buildAttentionQueue({ cases: [...cases, delivery("c2", "cp2")], projects, policy: { ...DEFAULT_ATTENTION_POLICY, maxRecommended: 2 } });
  ok("the delivery on the waiting anchor is not recommended", !recIds(q).includes("victor_delivery_no_followup:c2"));
  check("…it points at its anchor's representative", item(q, "victor_delivery_no_followup:c2").representedBy, "missed_internal_deadline:c2::WHY_INTERNAL_DEADLINE_PASSED");
}

console.log("C9. Equivalent candidates are identified; the ceiling never splits them arbitrarily");
{
  const { cases, projects } = internalDeadlines(3);
  const q = buildAttentionQueue({ cases, projects });
  ok("each is marked TIE_WITH_EQUIVALENT_CANDIDATES with the other two", q.recommended.every((r) => r.diagnostics.includes("TIE_WITH_EQUIVALENT_CANDIDATES") && r.equivalentTo.length === 2));
  // 1 label (stronger, alone) + 6 equivalent → the class of 6 cannot fit the remaining 4 → none of it, no arbitrary 4.
  const six = internalDeadlines(6, "e");
  const label = victorDeadline("L", "lp");
  const q2 = buildAttentionQueue({ cases: [label, ...six.cases], projects: { ...six.projects, lp: P({ businessType: "לייבל" }) } });
  check("only the distinguishable label question is recommended", recIds(q2), ["missed_internal_deadline:L"]);
  ok("the 6 equivalents wait together, flagged EQUIVALENT_CLASS_EXCEEDS_REMAINING_CAPACITY", q2.backlog.filter((b) => b.question.caseId.startsWith("missed_internal_deadline:e")).every((b) => b.deferralReason === "MAX_RECOMMENDED_REACHED" && b.diagnostics.includes("EQUIVALENT_CLASS_EXCEEDS_REMAINING_CAPACITY")));
  const q3 = buildAttentionQueue({ cases: [label, ...internalDeadlines(4, "f").cases, projectDeadline("weaker")], projects: { ...internalDeadlines(4, "f").projects, lp: P({ businessType: "לייבל" }), weaker: P() } });
  check("1 + a class of exactly 4 fits the ceiling of 5", q3.recommended.length, 5);
  const q4 = buildAttentionQueue({ cases: [label, ...six.cases, projectDeadline("weaker")], projects: { ...six.projects, lp: P({ businessType: "לייבל" }), weaker: P() } });
  check("a weaker class never jumps ahead of a class that did not fit", recIds(q4), ["missed_internal_deadline:L"]);
}

console.log("C10. questionId is never a business-priority reason");
{
  const { cases, projects } = internalDeadlines(6);
  const q = buildAttentionQueue({ cases: [...cases, task("t1", 30)], projects });
  ok("no explanation / factor basis mentions an id or ordering artifact", all(q).every((i) => i.explanation.concat(i.factors.map((f) => f.code)).every((x) => !/questionId|QUESTION_ID|TIE_BREAK|ORDER/i.test(x))));
  ok("explanations only use evidence codes", q.recommended.every((r) => r.explanation.every((x) => /^[A-Z_]+$/.test(x))));
  // Changing only the ids (same evidence) must not change WHICH evidence-level gets recommended.
  const renamed = internalDeadlines(6, "zz");
  check("same evidence, different ids → same recommended count", buildAttentionQueue({ cases: [...renamed.cases, task("t1", 30)], projects: renamed.projects }).recommended.length, q.recommended.length);
}

console.log("C11. Deterministic and stable");
{
  const cases = [projectDeadline("p1"), task("t1", 40), delivery("d1", "p2"), victorDeadline("v1", "p3"), financeConfig("p1"), stevenDeadline("s1", "p4")];
  const projects = { p1: P(), p2: P({ daysSinceUpdate: 3 }), p3: P(), p4: P({ daysSinceUpdate: 30 }) };
  const a = buildAttentionQueue({ cases, projects }), b = buildAttentionQueue({ cases: [...cases].reverse(), projects });
  check("same queue regardless of input order", JSON.stringify(a), JSON.stringify(b));
  check("same input twice → identical", JSON.stringify(buildAttentionQueue({ cases, projects })), JSON.stringify(a));
  check("ranks are 1..n without gaps", all(a).map((i) => i.rank).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);
}

console.log("Kept: RISK vs ATTENTION ordering, age ≠ urgency, active vs stale, Owner Rule reasons");
{
  const q = buildAttentionQueue({ cases: [delivery("d1", "a"), projectDeadline("b")], projects: { a: P(), b: P() } });
  ok("RISK project deadline ranks above ATTENTION delivery with the same activity evidence", rankOf(q, "project_deadline_passed:b") < rankOf(q, "victor_delivery_no_followup:d1"));
  const q2 = buildAttentionQueue({ cases: [delivery("d1", "a"), projectDeadline("b")], projects: { a: P({ businessType: "לייבל" }), b: P({ daysSinceUpdate: 60 }) } });
  check("…evidence decides: ATTENTION on an active label project is NOW, a RISK without recent activity is SOON", [item(q2, "victor_delivery_no_followup:d1").band, item(q2, "project_deadline_passed:b").band], ["NOW", "SOON"]);
  const qa = buildAttentionQueue({ cases: [task("a-300", 300), task("z-2", 2)] }), qb = buildAttentionQueue({ cases: [task("a-2", 2), task("z-300", 300)] });
  ok("age plays no part: swapping ids swaps the order", rankOf(qa, "task_due_date_passed:a-300") === 1 && rankOf(qb, "task_due_date_passed:a-2") === 1);
  ok("…and equal-evidence tasks are flagged as equivalent (not ranked by meaning)", item(qa, "task_due_date_passed:a-300").equivalenceKey === item(qa, "task_due_date_passed:z-2").equivalenceKey);
  const src = fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/queue.ts"), "utf8");
  ok("ordering never compares days_late / days_overdue (static)", !/sort\([\s\S]{0,600}days_(late|overdue)/.test(src));
  const q3 = buildAttentionQueue({ cases: [task("t1", 90), projectDeadline("p1", 10)], projects: { p1: P() } });
  check("active project problem NOW, stale standalone task SOON (not recommended)", [recIds(q3), item(q3, "task_due_date_passed:t1").band], [["project_deadline_passed:p1"], "SOON"]);
  const q4 = buildAttentionQueue({ cases: [victorDeadline("v1", "lbl")], projects: { lbl: P({ businessType: "לייבל" }) } });
  ok("Owner Rule factors are explicit, with a basis, and appear in WHY_RECOMMENDED", q4.recommended[0].factors.some((x) => x.code === "OWNER_RULE_PROTECT_LABEL_RELEASES" && /businessType=לייבל/.test(x.basis)) && q4.recommended[0].explanation.includes("OWNER_RULE_INTERNAL_DEADLINES_MATTER"));
  const viaRelease = buildAttentionQueue({ cases: [projectDeadline("r1")], projects: { r1: P({ daysSinceUpdate: 60 }) }, releases: { r1: { labelArtistId: "artist-1", stage: "מיקס" } } });
  ok("PROTECT_LABEL_RELEASES also from an explicit release labelArtistId", viaRelease.recommended[0]?.factors.some((x) => x.code === "OWNER_RULE_PROTECT_LABEL_RELEASES"));
  ok("no numeric score field", !("score" in q4.recommended[0]));
}

console.log("Kept: answered / resurfacing / backlog semantics");
{
  const c = projectDeadline("p1");
  const ctx = buildOwnerContext(decideInvestigation(c).question!, { answerCode: "DEADLINE_NOT_UPDATED", answeredAt: "2026-09-23T12:00:00.000Z" });
  const q = buildAttentionQueue({ cases: [c], projects: { p1: P() }, contexts: [ctx] });
  check("answered + facts unchanged → ANSWERED_UNCHANGED, not recommended", [q.recommended.length, q.answered[0].attentionState, q.answered[0].explanation], [0, "ANSWERED_NOT_RESURFACED", ["ANSWERED_UNCHANGED"]]);
  const changed = { ...c, facts: c.facts.map((f) => (f.field === "deadline" ? { ...f, value: "2026-08-01" } : f)) };
  check("facts changed → resurfaces", buildAttentionQueue({ cases: [changed], projects: { p1: P() }, contexts: [ctx] }).recommended[0]?.answerState, "ANSWERED_EVIDENCE_CHANGED");
  const aged = { ...c, derivedFacts: [{ id: "days_late", label: "x", value: 72, basis: "x" }] };
  check("only the daily age changed → still answered", buildAttentionQueue({ cases: [aged], projects: { p1: P() }, contexts: [ctx] }).answered.length, 1);
  const qb = buildAttentionQueue({ cases: [task("t1", 10), task("t2", 20)] });
  ok("not recommended ≠ resolved: backlog items stay UNANSWERED with a reason", qb.backlog.every((b) => b.answerState === "UNANSWERED" && b.attentionState === "NOT_CURRENTLY_RECOMMENDED" && b.deferralReason !== null));
  check("fact-complete Case (payment) produces no queue item", all(buildAttentionQueue({ cases: [payment("pp")] })).length, 0);
}

console.log("C12. No AI, no mutation, no baseline / feedback / context write");
{
  const cases = [projectDeadline("p1"), task("t1", 40)];
  const before = JSON.stringify(cases);
  buildAttentionQueue({ cases, projects: { p1: P() } });
  ok("input Cases unchanged", JSON.stringify(cases) === before);
  const src = fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/queue.ts"), "utf8");
  ok("no LLM / network import", !/openai|anthropic|fetch\(|lib\/mai/.test(src));
  ok("no baseline import / write", !/partner\/baseline|savePartnerBaseline|partner_change_baseline/.test(src));
  ok("no feedback store / DB write / owner-context table", !/feedback\/store|feedback\/persistence|lib\/supabase|partner_owner_context|\.(insert|update|upsert|delete)\(/.test(src));
  ok("no clock / randomness", !/Date\.now\(|new Date\(\)|Math\.random/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
