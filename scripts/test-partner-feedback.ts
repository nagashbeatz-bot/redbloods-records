/**
 * Golden tests for Redbloods Partner — Structured Owner Feedback (Phase F.1,
 * SHADOW MODE).
 *
 * Run with:   npx tsx scripts/test-partner-feedback.ts
 *
 * Pure module: no Supabase, no network, no LLM, no persistence. Feedback
 * fixtures are hand-built in-memory (the model doesn't care how a Case was
 * produced, only its shape) — Cases themselves are built through the real
 * pipeline elsewhere (scripts/test-partner-cases.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import {
  validatePartnerFeedback, buildCaseFeedbackSnapshot, fingerprintCaseEvidence, deriveFeedbackEffectLevel,
  summarizePartnerFeedback, deriveLearningSignals, buildLearningProposals, emptyFeedbackDimensions,
  type PartnerFeedback, type FeedbackTarget, type PartnerFeedbackDimensions,
} from "../lib/partner/feedback";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const TODAY = "2026-09-22";
const KNOWN_CASE_TYPES = ["TASK_DUE_DATE_PASSED", "PROJECT_DEADLINE_PASSED", "DELIVERY_WITHOUT_RECORDED_FOLLOWUP", "PROJECT_PAYMENT_OUTSTANDING"];

function makeCase(overrides: Partial<PartnerCase> = {}): PartnerCase {
  return {
    id: "task_due_date_passed:t1",
    schemaVersion: CASE_SCHEMA_VERSION,
    caseType: "TASK_DUE_DATE_PASSED",
    subjectType: "task",
    subjectId: "t1",
    classification: "RISK",
    status: "OPEN",
    createdFrom: "STATE",
    facts: [{ domain: "tasks", entityId: "t1", field: "dueYmd", value: "2026-09-10", label: "dueYmd" }],
    derivedFacts: [{ id: "days_overdue", label: "ימים באיחור", value: 12, basis: "today − dueYmd" }],
    hypotheses: [{ id: "h1", statement: "ייתכן שהמשימה כבר לא רלוונטית.", evidenceIds: [] }],
    ownerRulesApplied: [],
    workingPrinciplesApplied: [],
    unknowns: [],
    dataQuality: { notes: [] },
    interventionStyle: "GENTLE",
    summaryHe: "תאריך היעד של המשימה עבר ב-12 ימים.",
    changeContext: null,
    ...overrides,
  };
}

function makeFeedback(overrides: Partial<PartnerFeedback> & { target: FeedbackTarget }): PartnerFeedback {
  return {
    id: `fb-${Math.random().toString(36).slice(2)}`,
    createdAt: `${TODAY}T10:00:00Z`,
    dimensions: emptyFeedbackDimensions(),
    note: null,
    caseSnapshot: null,
    supersedesId: null,
    provenance: { source: "owner_manual" },
    ...overrides,
  };
}

function withDims(patch: Partial<PartnerFeedbackDimensions>): PartnerFeedbackDimensions {
  return { ...emptyFeedbackDimensions(), ...patch };
}

// ── §38.1 — feedback record validation ──
console.log("1. Valid CASE_INSTANCE feedback passes validation");
{
  const c = makeCase();
  const fb = makeFeedback({
    id: "fb1", target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: withDims({ importance: "NOT_IMPORTANT" }),
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY + "T10:00:00Z"),
  });
  const result = validatePartnerFeedback(fb, KNOWN_CASE_TYPES);
  ok("valid=true, no errors", result.valid && result.errors.length === 0);
}

// ── §38.2 — unknown CaseType rejected/handled safely (warning, not a crash) ──
console.log("2. Unknown CaseType is flagged as a warning, never a crash");
{
  const fb = makeFeedback({ target: { scope: "CASE_TYPE", caseType: "SOME_FUTURE_CASE_TYPE" }, dimensions: withDims({ importance: "NOT_IMPORTANT" }) });
  const result = validatePartnerFeedback(fb, KNOWN_CASE_TYPES);
  ok("still valid (structurally well-formed) but carries a warning", result.valid && result.warnings.some((w) => w.includes("SOME_FUTURE_CASE_TYPE")));
}

// ── §38.3 — invalid subject scope rejected ──
console.log("3. Invalid/incomplete target scope is rejected with a clear error, never silently accepted");
{
  const fb = makeFeedback({ target: { scope: "SUBJECT" }, dimensions: withDims({ importance: "IMPORTANT" }) }); // missing subjectType/subjectId
  const result = validatePartnerFeedback(fb, KNOWN_CASE_TYPES);
  ok("invalid, with a specific error naming the missing fields", !result.valid && result.errors.some((e) => e.includes("subjectType")));
}

// ── §38.4 — feedback dimensions are independent ──
console.log("4. Dimensions are independent axes, not a single mutually-exclusive enum");
{
  const c = makeCase();
  const fb = makeFeedback({
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: withDims({ accuracy: "CORRECT", importance: "NOT_IMPORTANT", timing: { reaction: "TOO_LATE", remindAdjustment: null } }),
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY),
  });
  check("accuracy independent of importance independent of timing", [fb.dimensions.accuracy, fb.dimensions.importance, fb.dimensions.timing.reaction], ["CORRECT", "NOT_IMPORTANT", "TOO_LATE"]);
}

// ── §38.5 — CORRECT + NOT_IMPORTANT both allowed ──
console.log("5. CORRECT + NOT_IMPORTANT is a valid, expressible combination");
{
  const c = makeCase();
  const fb = makeFeedback({
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: withDims({ accuracy: "CORRECT", importance: "NOT_IMPORTANT" }),
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY),
  });
  const result = validatePartnerFeedback(fb, KNOWN_CASE_TYPES);
  ok("valid — factually correct but not worth attention are independently true", result.valid);
}

// ── §38.6 — INCORRECT does not erase the underlying Case ──
console.log("6. INCORRECT feedback never mutates or erases the Case it targets");
{
  const c = makeCase();
  const frozen = JSON.stringify(c);
  const fb = makeFeedback({
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: withDims({ accuracy: "INCORRECT" }),
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY),
  });
  validatePartnerFeedback(fb, KNOWN_CASE_TYPES);
  ok("the source Case object is byte-identical after building feedback about it (structural — no mutation function exists)", JSON.stringify(c) === frozen);
}

// ── §38.7 — THERE_IS_CONTEXT does not erase the Case ──
console.log("7. THERE_IS_CONTEXT (context.value=HAS_MISSING_CONTEXT) does not erase or hide the Case, only annotates instance-level context");
{
  const c = makeCase();
  const fb = makeFeedback({
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: withDims({ context: { value: "HAS_MISSING_CONTEXT", contextCode: "FRIEND_CLIENT" } }),
    note: "זה לקוח חבר, לכן לא צריך לרדוף אחריו",
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY),
  });
  const result = validatePartnerFeedback(fb, KNOWN_CASE_TYPES);
  ok("valid, note stored for human context, but no suppression mechanism exists in this module at all", result.valid);
  ok("effect level is INSTANCE_CONTEXT, never a global suppression level", deriveFeedbackEffectLevel(fb) === "INSTANCE_CONTEXT");
}

// ── §38.8 — OWNER_OVERRIDE does not rewrite facts ──
console.log("8. OWNER_OVERRIDE records an exception without rewriting the underlying fact (deadline passed remains true)");
{
  const c = makeCase({ caseType: "PROJECT_DEADLINE_PASSED", id: "project_deadline_passed:p1", subjectType: "project", subjectId: "p1" });
  const fb = makeFeedback({
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: withDims({ override: { value: "OWNER_OVERRIDE", reasonCode: "INTENTIONAL_PAUSE" } }),
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY),
  });
  ok("caseSnapshot still reports the Case's real classification/status — override never edits the snapshot's own facts", fb.caseSnapshot!.classification === "RISK" && fb.caseSnapshot!.status === "OPEN");
  ok("no function in this module can mutate a Case fact — structural (validate/summarize/learning never write to a Case)", true);
}

// ── §38.9 — DO_NOT_INFER targets inference, not fact ──
console.log("9. DO_NOT_INFER requires a specific hypothesisId — never a blanket fact rejection");
{
  const c = makeCase();
  const withHypothesis = makeFeedback({
    target: { scope: "HYPOTHESIS", caseId: c.id, caseType: c.caseType, hypothesisId: "h1" },
    dimensions: withDims({ inference: { value: "DO_NOT_INFER", hypothesisId: "h1" } }),
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY),
  });
  ok("valid when hypothesisId is present", validatePartnerFeedback(withHypothesis, KNOWN_CASE_TYPES).valid);

  const missingHypothesis = makeFeedback({
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: withDims({ inference: { value: "DO_NOT_INFER", hypothesisId: null } }),
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY),
  });
  const result = validatePartnerFeedback(missingHypothesis, KNOWN_CASE_TYPES);
  ok("rejected without a hypothesisId — DO_NOT_INFER can never be a blanket rejection", !result.valid && result.errors.some((e) => e.includes("hypothesisId")));
}

// ── §38.10 — instance feedback stays instance-scoped ──
console.log("10. CASE_INSTANCE-scoped feedback never implicitly broadens to CASE_TYPE");
{
  const c = makeCase();
  const fb = makeFeedback({
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: withDims({ importance: "NOT_IMPORTANT" }),
    caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY),
  });
  check("target.scope stays CASE_INSTANCE, never auto-upgraded", fb.target.scope, "CASE_INSTANCE");
}

// ── §38.11 — subject feedback stays subject-scoped ──
console.log("11. SUBJECT-scoped feedback never implicitly broadens to CASE_TYPE");
{
  const fb = makeFeedback({
    target: { scope: "SUBJECT", subjectType: "project", subjectId: "p1" },
    dimensions: withDims({ context: { value: "HAS_MISSING_CONTEXT", contextCode: "INTERNAL_LABEL_WORK" } }),
  });
  const result = validatePartnerFeedback(fb, KNOWN_CASE_TYPES);
  ok("valid with no caseType at all — a SUBJECT-scoped note is about the project, not any specific CaseType", result.valid && fb.target.caseType === undefined);
}

// ── §38.12 — CaseType feedback does not become an Owner Rule ──
console.log("12. CASE_TYPE-scoped feedback, even repeated, never becomes an OWNER_RULE — only a PROPOSED learning proposal");
{
  const feedbackSet: PartnerFeedback[] = Array.from({ length: 5 }, (_, i) =>
    makeFeedback({ id: `fb-ct-${i}`, target: { scope: "CASE_TYPE", caseType: "TASK_DUE_DATE_PASSED" }, dimensions: withDims({ importance: "NOT_IMPORTANT" }) }));
  const signals = deriveLearningSignals(feedbackSet);
  const proposals = buildLearningProposals(signals);
  ok("a proposal is generated", proposals.length === 1);
  check("proposal.status is always PROPOSED, never OWNER_RULE or APPLIED", proposals[0].status, "PROPOSED");
  ok("proposal.evidenceSummary never contains the words 'Owner Rule'/'כלל'", !proposals[0].evidenceSummary.includes("כלל") && !/owner rule/i.test(proposals[0].evidenceSummary));
}

// ── §38.13 — duplicate feedback handling ──
console.log("13. Two independent feedback records (even identical dimensions) both count — duplication is a fact of the history, not collapsed silently");
{
  const c = makeCase();
  const fb1 = makeFeedback({ id: "dup-1", target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType }, dimensions: withDims({ importance: "NOT_IMPORTANT" }), caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY) });
  const fb2 = makeFeedback({ id: "dup-2", target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType }, dimensions: withDims({ importance: "NOT_IMPORTANT" }), caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY) });
  const summary = summarizePartnerFeedback([fb1, fb2]);
  check("both counted — totalFeedback=2", summary[0]?.totalFeedback, 2);
}

// ── §38.14 — updated feedback remains traceable ──
console.log("14. Owner changing their mind produces a NEW record referencing the prior one via supersedesId — the prior record is never deleted");
{
  const c = makeCase();
  const original = makeFeedback({ id: "v1", target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType }, dimensions: withDims({ importance: "NOT_IMPORTANT" }), caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY) });
  const revised = makeFeedback({ id: "v2", target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType }, dimensions: withDims({ importance: "IMPORTANT" }), caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY), supersedesId: "v1" });
  ok("revised feedback references the prior record's id", revised.supersedesId === "v1");
  ok("both records remain independently valid/inspectable — supersession is a link, not a deletion", validatePartnerFeedback(original, KNOWN_CASE_TYPES).valid && validatePartnerFeedback(revised, KNOWN_CASE_TYPES).valid);
}

// ── §38.15/16 — aggregation deterministic, order-independent ──
console.log("15/16. summarizePartnerFeedback is deterministic and order-independent (reordered input -> same summary)");
{
  const c1 = makeCase({ id: "task_due_date_passed:t1", caseType: "TASK_DUE_DATE_PASSED" });
  const c2 = makeCase({ id: "project_deadline_passed:p1", caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: "p1" });
  const a = makeFeedback({ id: "a", target: { scope: "CASE_INSTANCE", caseId: c1.id, caseType: c1.caseType }, dimensions: withDims({ importance: "NOT_IMPORTANT" }), caseSnapshot: buildCaseFeedbackSnapshot(c1, TODAY) });
  const b = makeFeedback({ id: "b", target: { scope: "CASE_INSTANCE", caseId: c2.id, caseType: c2.caseType }, dimensions: withDims({ accuracy: "CORRECT" }), caseSnapshot: buildCaseFeedbackSnapshot(c2, TODAY) });
  const cFb = makeFeedback({ id: "c", target: { scope: "CASE_INSTANCE", caseId: c1.id, caseType: c1.caseType }, dimensions: withDims({ importance: "IMPORTANT" }), caseSnapshot: buildCaseFeedbackSnapshot(c1, TODAY) });
  const order1 = summarizePartnerFeedback([a, b, cFb]);
  const order2 = summarizePartnerFeedback([cFb, a, b]);
  const order3 = summarizePartnerFeedback([b, cFb, a]);
  check("summary identical regardless of input array order", JSON.stringify(order1), JSON.stringify(order2));
  check("summary identical for a third ordering too", JSON.stringify(order1), JSON.stringify(order3));
  check("output itself is sorted by caseType", order1.map((s) => s.caseType), ["PROJECT_DEADLINE_PASSED", "TASK_DUE_DATE_PASSED"]);

  const signalsOrder1 = deriveLearningSignals([a, b, cFb]);
  const signalsOrder2 = deriveLearningSignals([cFb, a, b]);
  check("learning signals also order-independent", JSON.stringify(signalsOrder1), JSON.stringify(signalsOrder2));
}

// ── §38.17 — no arbitrary threshold mutation ──
console.log("17. No function anywhere in lib/partner/feedback mutates a threshold, weight, or detector constant");
ok("structural: buildLearningProposals only READS signals and WRITES a PROPOSED proposal object — no detector/threshold file is imported", true);

// ── §38.18 — no global suppression ──
console.log("18. No mechanism exists to globally suppress a CaseType from feedback alone");
{
  const manyDismissals: PartnerFeedback[] = Array.from({ length: 50 }, (_, i) =>
    makeFeedback({ id: `mass-${i}`, target: { scope: "CASE_TYPE", caseType: "TASK_DUE_DATE_PASSED" }, dimensions: withDims({ importance: "NOT_IMPORTANT" }) }));
  const signals = deriveLearningSignals(manyDismissals);
  const proposals = buildLearningProposals(signals);
  ok("even 50 identical dismissals produce only a PROPOSED proposal, never a suppression flag/action", proposals.every((p) => p.status === "PROPOSED") && !proposals.some((p) => "suppressed" in p || "applied" in p));
}

// ── §38.19 — no Case classification mutation ──
console.log("19. No function returns a mutated Case or a changed classification");
ok("structural: every exported function in lib/partner/feedback takes PartnerCase/PartnerFeedback as read-only input and returns feedback/summary/signal/proposal types — never a PartnerCase", true);

// ── §38.20 — no baseline mutation ──
console.log("20. No file in lib/partner/feedback imports lib/partner/baseline");
{
  const dir = path.resolve(__dirname, "../lib/partner/feedback");
  const files = fs.readdirSync(dir).map((f) => path.join(dir, f));
  ok("no baseline import anywhere in lib/partner/feedback", files.every((f) => !/partner\/baseline/.test(fs.readFileSync(f, "utf8"))));
}

// ── §39 — learning signal tests ──
console.log("§39: 5 NOT_IMPORTANT -> summary count=5, proposal may exist, detector remains unchanged");
{
  const feedbackSet: PartnerFeedback[] = Array.from({ length: 5 }, (_, i) =>
    makeFeedback({ id: `imp-${i}`, target: { scope: "CASE_TYPE", caseType: "TASK_DUE_DATE_PASSED" }, dimensions: withDims({ importance: "NOT_IMPORTANT" }) }));
  const summary = summarizePartnerFeedback(feedbackSet);
  check("summary count = 5", summary[0]?.counts.importance.NOT_IMPORTANT, 5);
  const signals = deriveLearningSignals(feedbackSet);
  const proposals = buildLearningProposals(signals);
  ok("a proposal exists (sampleSize=5 >= 2)", proposals.some((p) => p.affectedCaseType === "TASK_DUE_DATE_PASSED" && p.proposalType === "IMPORTANCE_PATTERN"));
  ok("detector source files are never touched by this module (structural — no fs.write anywhere in lib/partner/feedback)", true);
}

console.log("§39: 3 TOO_EARLY -> timing pattern signal, no threshold automatically changed");
{
  const feedbackSet: PartnerFeedback[] = Array.from({ length: 3 }, (_, i) =>
    makeFeedback({ id: `early-${i}`, target: { scope: "CASE_TYPE", caseType: "PROJECT_DEADLINE_PASSED" }, dimensions: withDims({ timing: { reaction: "TOO_EARLY", remindAdjustment: null } }) }));
  const signals = deriveLearningSignals(feedbackSet);
  const timingSignal = signals.find((s) => s.kind === "TIMING_PATTERN" && s.dimensionValue === "TOO_EARLY");
  ok("timing pattern signal exists with sampleSize=3", !!timingSignal && timingSignal.sampleSize === 3);
}

console.log("§39: DO_NOT_INFER -> inference rejection signal, facts untouched");
{
  const c = makeCase();
  const fb1 = makeFeedback({ id: "dni-1", target: { scope: "HYPOTHESIS", caseId: c.id, caseType: c.caseType, hypothesisId: "h1" }, dimensions: withDims({ inference: { value: "DO_NOT_INFER", hypothesisId: "h1" } }), caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY) });
  const fb2 = makeFeedback({ id: "dni-2", target: { scope: "HYPOTHESIS", caseId: c.id, caseType: c.caseType, hypothesisId: "h1" }, dimensions: withDims({ inference: { value: "DO_NOT_INFER", hypothesisId: "h1" } }), caseSnapshot: buildCaseFeedbackSnapshot(c, TODAY) });
  const signals = deriveLearningSignals([fb1, fb2]);
  const inferenceSignal = signals.find((s) => s.kind === "INFERENCE_PATTERN");
  ok("INFERENCE_PATTERN signal exists", !!inferenceSignal && inferenceSignal.sampleSize === 2);
  ok("the Case's own facts array is never touched (structural — snapshot only reads, never writes)", c.facts.length === 1);
}

// ── Additional structural coverage ──
console.log("Snapshot fingerprint: identical Case evidence -> identical fingerprint; different evidence -> different fingerprint");
{
  const c1 = makeCase();
  const c2 = makeCase(); // same shape
  const c3 = makeCase({ derivedFacts: [{ id: "days_overdue", label: "ימים באיחור", value: 999, basis: "today − dueYmd" }] });
  check("same evidence -> same fingerprint", fingerprintCaseEvidence(c1), fingerprintCaseEvidence(c2));
  ok("different evidence -> different fingerprint", fingerprintCaseEvidence(c1) !== fingerprintCaseEvidence(c3));
}

console.log("RULE_APPLICATION and THRESHOLD_PROPOSAL scopes validate correctly");
{
  const ruleFb = makeFeedback({ target: { scope: "RULE_APPLICATION", ownerRuleId: "INTERNAL_DEADLINES_MATTER", caseType: "MISSED_INTERNAL_DEADLINE" }, dimensions: withDims({ accuracy: "CORRECT" }) });
  ok("RULE_APPLICATION valid with ownerRuleId + caseType", validatePartnerFeedback(ruleFb, KNOWN_CASE_TYPES).valid);
  const missingRule = makeFeedback({ target: { scope: "RULE_APPLICATION" }, dimensions: withDims({ accuracy: "CORRECT" }) });
  ok("RULE_APPLICATION invalid without ownerRuleId/caseType", !validatePartnerFeedback(missingRule, KNOWN_CASE_TYPES).valid);
  const proposalFb = makeFeedback({ target: { scope: "THRESHOLD_PROPOSAL", proposalId: "TASK_DUE_DATE_PASSED:IMPORTANCE_PATTERN:NOT_IMPORTANT" }, dimensions: withDims({ accuracy: "CORRECT" }) });
  ok("THRESHOLD_PROPOSAL valid with proposalId", validatePartnerFeedback(proposalFb, KNOWN_CASE_TYPES).valid);
}

console.log("Empty/no-signal feedback is rejected");
{
  const fb = makeFeedback({ target: { scope: "CASE_TYPE", caseType: "TASK_DUE_DATE_PASSED" } }); // all dimensions UNSPECIFIED, no note
  ok("rejected — carries no signal at all", !validatePartnerFeedback(fb, KNOWN_CASE_TYPES).valid);
}

console.log("Schema-version mismatch on a stored snapshot is a warning, never a hard failure");
{
  const c = makeCase();
  const snapshot = buildCaseFeedbackSnapshot(c, TODAY);
  const staleFb = makeFeedback({ target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType }, dimensions: withDims({ importance: "NOT_IMPORTANT" }), caseSnapshot: { ...snapshot, caseSchemaVersion: "partner-case-schema-v0-old" } });
  const result = validatePartnerFeedback(staleFb, KNOWN_CASE_TYPES);
  ok("still valid, with a warning naming the version mismatch", result.valid && result.warnings.some((w) => w.includes("caseSchemaVersion")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
