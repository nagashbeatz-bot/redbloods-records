/**
 * Golden tests for Redbloods Partner — Investigation & Owner Context loop
 * (Phase F.1C, SHADOW MODE).
 *
 * Run with:   npx tsx scripts/test-partner-investigation.ts
 *
 * Pure module: no Supabase, no network, no LLM, no persistence. Fixtures
 * reproduce the exact SHAPE of real production Cases (e.g.
 * project_deadline_passed:10d23186-… — deadline 2026-07-14, status במיקס,
 * 71 days late, updated 1 day ago); nothing is read from or written to
 * production.
 */
import fs from "node:fs";
import path from "node:path";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import { CHARTER_ITEMS, getCharterRule } from "../lib/partner";
import { emptyFeedbackDimensions, type PartnerFeedback } from "../lib/partner/feedback";
import {
  decideInvestigation, decideInvestigations, buildInvestigationQuestions, questionIdFor,
  buildOwnerContext, validateOwnerContext, questionStatus, interpretCase,
  deriveContextLearningSignals, buildContextLearningProposals, resolveCurrentContexts,
  INVESTIGATION_OWNER_RULE, type PartnerInvestigationQuestion,
} from "../lib/partner/investigation";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

function base(overrides: Partial<PartnerCase>): PartnerCase {
  return {
    id: "x:1", schemaVersion: CASE_SCHEMA_VERSION, caseType: "X", subjectType: "project", subjectId: "1",
    classification: "RISK", status: "OPEN", createdFrom: "STATE", facts: [], derivedFacts: [], hypotheses: [],
    ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
    interventionStyle: "GENTLE", summaryHe: "", changeContext: null, ...overrides,
  };
}

// Real shape: project_deadline_passed:10d23186-a5ab-4eed-a9a4-eeda221a34d5 ("קרוב אלייך")
const PID = "10d23186-a5ab-4eed-a9a4-eeda221a34d5";
function projectDeadlineCase(o: { id?: string; status?: string; late?: number; sinceUpdate?: number | null } = {}): PartnerCase {
  const id = o.id ?? PID, late = o.late ?? 71, since = o.sinceUpdate === undefined ? 1 : o.sinceUpdate;
  const derivedFacts: PartnerCase["derivedFacts"] = [{ id: "days_late", label: "ימים באיחור", value: late, basis: "2026-09-23 − 2026-07-14" }];
  if (since !== null) {
    derivedFacts.push({ id: "days_since_update", label: "ימים מאז עדכון אחרון", value: since, basis: "today − updated_at" });
    derivedFacts.push({ id: "activity_after_deadline", label: "עדות לעדכון אחרי הדדליין", value: since < late, basis: "proxy" });
  }
  return base({
    id: `project_deadline_passed:${id}`, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: id,
    facts: [
      { domain: "projects", entityId: id, field: "deadline", value: "2026-07-14", label: "deadline" },
      { domain: "projects", entityId: id, field: "status", value: o.status ?? "במיקס", label: "status" },
    ],
    derivedFacts,
    dataQuality: { notes: ["Projects scope excludes hidden projects (is_hidden=false only) — no conclusion drawn about hidden ones."] },
    summaryHe: `הדדליין של הפרויקט עבר ב-${late} ימים.`,
  });
}
const deliveryCase = () => base({
  id: "victor_delivery_no_followup:455c45c8-903d-4b65-8876-3e557b60d844", caseType: "DELIVERY_WITHOUT_RECORDED_FOLLOWUP", classification: "ATTENTION",
  subjectType: "victorWork", subjectId: "455c45c8-903d-4b65-8876-3e557b60d844",
  facts: [
    { domain: "victor", entityId: "455c45c8", field: "lastUploadAt", value: "2026-09-19T14:29:35.030Z", label: "lastUploadAt" },
    { domain: "victor", entityId: "455c45c8", field: "ball.code", value: "upload_after_notes", label: "ball.code" },
  ],
  derivedFacts: [{ id: "days_since_delivery", label: "ימים מאז המסירה", value: 4, basis: "today − lastUploadAt" }, { id: "has_any_historical_review", label: "review", value: true, basis: "reviewEvents.length = 1" }],
  hypotheses: [{ id: "may_be_pending_review", statement: "ייתכן שהמסירה עדיין ממתינה לבדיקת הבעלים.", evidenceIds: [] }],
  unknowns: ["האם הבעלים כבר בדק את המסירה מחוץ למערכת — לא ידוע."],
});
const taskCase = () => base({
  id: "task_due_date_passed:2c161654-3aa7-40c9-98cf-6276bda364bd", caseType: "TASK_DUE_DATE_PASSED", subjectType: "task", subjectId: "2c161654-3aa7-40c9-98cf-6276bda364bd",
  facts: [{ domain: "tasks", entityId: "2c161654", field: "dueYmd", value: "2026-08-26", label: "dueYmd" }, { domain: "tasks", entityId: "2c161654", field: "projectId", value: null, label: "projectId" }],
  derivedFacts: [{ id: "days_overdue", label: "ימים באיחור", value: 28, basis: "today − dueYmd" }],
});
const financeCase = () => base({
  id: `finance_configuration_missing:${PID}`, caseType: "FINANCE_CONFIGURATION_MISSING", classification: "INFORMATION", status: "NEEDS_CONTEXT", subjectId: PID,
  facts: [{ domain: "projects", entityId: PID, field: "hasFinanceSetting", value: false, label: "hasFinanceSetting" }],
  unknowns: ["האם למחיר הפרויקט יש סיבה מכוונת להישאר לא מוגדר — לא ידוע."],
});
const stevenCase = () => base({
  id: "steven_internal_deadline_passed:4275f19b-3423-4e34-aafc-30cc5182aee3", caseType: "STEVEN_INTERNAL_DEADLINE_PASSED", subjectType: "stevenWork", subjectId: "4275f19b-3423-4e34-aafc-30cc5182aee3",
  facts: [{ domain: "steven", entityId: "4275f19b", field: "internalDeadline", value: "2026-09-21", label: "internalDeadline" }, { domain: "steven", entityId: "4275f19b", field: "status", value: "נשלח", label: "status" }],
  derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: 2, basis: "internalDeadline − today" }],
  ownerRulesApplied: ["INTERNAL_DEADLINES_MATTER"],
  unknowns: ["מי אחראי לפעולה הבאה (Steven או הבעלים) — לא ידוע, ה-ball של Steven אינו נחשף ל-Partner."],
});
const victorDeadlineCase = () => base({
  id: "missed_internal_deadline:bd8bab9a-fdde-4dc3-b169-e1a510adec50", caseType: "MISSED_INTERNAL_DEADLINE", subjectType: "victorWork", subjectId: "bd8bab9a-fdde-4dc3-b169-e1a510adec50",
  facts: [{ domain: "victor", entityId: "bd8bab9a", field: "internalDeadline", value: "2026-09-17", label: "internalDeadline" }, { domain: "victor", entityId: "bd8bab9a", field: "workState", value: "נשלח לויקטור", label: "workState" }],
  derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: 6, basis: "x" }, { id: "delivery_after_deadline", label: "x", value: true, basis: "uploads" }],
  ownerRulesApplied: ["INTERNAL_DEADLINES_MATTER"],
});
const paymentCase = () => base({
  id: "project_payment_outstanding:79a1f447-c02d-4ce2-aa7f-04417397389d", caseType: "PROJECT_PAYMENT_OUTSTANDING", classification: "ATTENTION", subjectId: "79a1f447-c02d-4ce2-aa7f-04417397389d",
  facts: [{ domain: "receivables", entityId: "79a1f447", field: "agreedPrice", value: 3200, label: "agreedPrice" }, { domain: "receivables", entityId: "79a1f447", field: "received", value: 1600, label: "received" }],
  derivedFacts: [{ id: "outstanding", label: "יתרה לתשלום", value: 1600, basis: "agreedPrice − received" }],
});

const q = (c: PartnerCase): PartnerInvestigationQuestion => {
  const d = decideInvestigation(c);
  if (!d.question) throw new Error(`expected a question for ${c.id}`);
  return d.question;
};
const feedback = (c: PartnerCase, dims: Partial<ReturnType<typeof emptyFeedbackDimensions>>): PartnerFeedback => ({
  id: "fb-1", schemaVersion: "partner-feedback-schema-v1", createdAt: "2026-09-23T10:00:00.000Z",
  target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType, subjectType: c.subjectType, subjectId: c.subjectId },
  dimensions: { ...emptyFeedbackDimensions(), ...dims }, note: null, caseSnapshot: null, supersedesId: null, provenance: { source: "owner_manual" },
});
const ACCUSATORY = /ניהלת|אשמ|נכשל|הזנחת|מאחר|לא עמד|לא עמדת|שכחת|באשמת|לא טיפלת|רשלנ/;

console.log("1. Fact-complete Case (payment outstanding) → no question");
{
  const d = decideInvestigation(paymentCase());
  check("no question", d.question, null);
  check("reason FACT_COMPLETE", d.noQuestionReason, "FACT_COMPLETE");
  ok("explains why (fact certainty ≠ causal uncertainty)", /מחושבת/.test(d.explanationHe));
  check("unknown catalog type → NOT_IN_V1_TAXONOMY, no guess", decideInvestigation(base({ caseType: "PROPOSAL_FOLLOWUP_DUE" })).noQuestionReason, "NOT_IN_V1_TAXONOMY");
  check("RESOLVED_BY_STATE → CONDITION_NOT_ACTIVE", decideInvestigation(projectDeadlineCase()).question !== null && decideInvestigation({ ...projectDeadlineCase(), status: "RESOLVED_BY_STATE" }).noQuestionReason, "CONDITION_NOT_ACTIVE");
}

console.log("2. Project deadline + active + recent activity → WHY_DEADLINE_STILL_ACTIVE (real Case 3 shape)");
{
  const question = q(projectDeadlineCase());
  check("type", question.questionType, "WHY_DEADLINE_STILL_ACTIVE");
  check("exact Hebrew text", question.questionTextHe, "הדדליין של הפרויקט עבר לפני 71 ימים, אבל הפרויקט עדיין פעיל ועודכן אתמול. מה הסיבה שהדדליין הישן עדיין מוגדר?");
  check("answer codes (incl. admitting a management gap + OTHER)", question.answerOptions.map((o) => o.code), ["DEADLINE_NOT_UPDATED", "INTENTIONALLY_DELAYED", "CLIENT_DELAY", "ARTIST_DELAY", "QUALITY_WORK_CONTINUED", "EXTERNAL_DEPENDENCY", "PROJECT_WAS_PAUSED", "DEADLINE_NO_LONGER_RELEVANT", "OTHER"]);
  check("facts referenced", question.factsReferenced, ["deadline", "status", "days_late", "days_since_update", "activity_after_deadline"]);
  check("owner rule", question.ownerRuleApplied, "INVESTIGATE_BEFORE_CONCLUDING");
  ok("INVESTIGATE_BEFORE_CONCLUDING is an OWNER_RULE in the Charter", getCharterRule(INVESTIGATION_OWNER_RULE)?.status === "OWNER_RULE");
  check("identity copied from the Case", [question.caseId, question.caseType, question.subjectType, question.subjectId], [`project_deadline_passed:${PID}`, "PROJECT_DEADLINE_PASSED", "project", PID]);
  ok("free text allowed", question.allowsFreeText === true);
  check("no activity since deadline → still asks, wording reflects it", q(projectDeadlineCase({ sinceUpdate: 80, late: 71 })).questionTextHe, "הדדליין של הפרויקט עבר לפני 71 ימים, הפרויקט עדיין פתוח ולא עודכן מאז. מה הסיבה שהדדליין הישן עדיין מוגדר?");
}

console.log("3. Completed / cancelled project → no active-deadline investigation");
{
  for (const s of ["הושלם", "בוטל"]) {
    const d = decideInvestigation(projectDeadlineCase({ status: s }));
    check(`status ${s} → no question (CONDITION_NOT_ACTIVE)`, [d.question, d.noQuestionReason], [null, "CONDITION_NOT_ACTIVE"]);
  }
}

console.log("4. Delivery without follow-up → outside-system-review question");
{
  const question = q(deliveryCase());
  check("type", question.questionType, "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM");
  check("text", question.questionTextHe, "Victor העלה מסירה לפני 4 ימים, ומאז לא נרשם follow-up במערכת. האם המסירה נבדקה או טופלה מחוץ למערכת?");
  ok("offers both 'reviewed outside' and 'not reviewed yet'", ["REVIEWED_OUTSIDE_SYSTEM", "NOT_REVIEWED_YET"].every((c) => question.answerOptions.some((o) => o.code === c)));
}

console.log("5. Task overdue → still-relevant question");
{
  const question = q(taskCase());
  check("type", question.questionType, "IS_TASK_STILL_RELEVANT");
  check("text", question.questionTextHe, "המשימה עדיין פתוחה ותאריך היעד שלה עבר לפני 28 ימים. האם היא עדיין רלוונטית?");
}

console.log("6. Missing finance config → intentional-config question");
{
  const question = q(financeCase());
  check("type", question.questionType, "IS_MISSING_FINANCE_CONFIG_INTENTIONAL");
  check("text", question.questionTextHe, "לפרויקט פעיל לא מוגדר תמחור. האם זה מכוון?");
  ok("offers FORGOT_TO_CONFIGURE (owner may admit a gap)", question.answerOptions.some((o) => o.code === "FORGOT_TO_CONFIGURE"));
}

console.log("7. Steven deadline question never blames Steven");
{
  const question = q(stevenCase());
  check("text", question.questionTextHe, "הדדליין הפנימי של העבודה עם Steven עבר לפני 2 ימים והעבודה עדיין פתוחה. ל-Partner אין מידע אצל מי הפעולה הבאה. מה מצב העבודה?");
  ok("states the ball holder is unknown", /אין מידע אצל מי הפעולה הבאה/.test(question.questionTextHe) && /לא ידוע/.test(question.reasonHe));
  ok("never asks why Steven is late / never names Steven as the cause", !/למה Steven|Steven מאחר|Steven לא|באשמת Steven|Steven איחר/.test(question.questionTextHe + question.reasonHe + question.answerOptions.map((o) => o.labelHe + (o.derivedHe ?? "")).join(" ")));
  ok("offers BOTH 'next action is mine' and 'next action is the collaborator's'", ["WAITING_ON_OWNER", "WAITING_ON_COLLABORATOR"].every((c) => question.answerOptions.some((o) => o.code === c)));
  const vq = q(victorDeadlineCase());
  check("Victor internal deadline text (neutral, fact-grounded)", vq.questionTextHe, "הדדליין הפנימי של העבודה עבר לפני 6 ימים והעבודה עדיין פתוחה, ונרשמו העלאות אחרי הדדליין. מה גרם לכך שהיא עדיין פתוחה?");
  const all = [projectDeadlineCase(), deliveryCase(), taskCase(), financeCase(), stevenCase(), victorDeadlineCase()].map(q);
  ok("no question text / label / derived statement is accusatory", all.every((x) => !ACCUSATORY.test(x.questionTextHe + x.reasonHe + x.answerOptions.map((o) => o.labelHe + (o.derivedHe ?? "") + (o.hypothesisHe ?? "")).join(" "))));
  ok("no generic 'provide more context' question", all.every((x) => !/(ספק|תן|אפשר לקבל).{0,10}(עוד )?context|מידע נוסף/.test(x.questionTextHe)));
  ok("every question ends with OTHER", all.every((x) => x.answerOptions[x.answerOptions.length - 1].code === "OTHER"));
}

console.log("8/9. Deterministic question ids; same Case → same question");
{
  const c = projectDeadlineCase();
  check("id = caseId::questionType", q(c).id, `project_deadline_passed:${PID}::WHY_DEADLINE_STILL_ACTIVE`);
  check("questionIdFor helper", questionIdFor(c.id, "WHY_DEADLINE_STILL_ACTIVE"), q(c).id);
  check("same Case twice → identical question object", JSON.stringify(q(c)), JSON.stringify(q(projectDeadlineCase())));
  const cases = [paymentCase(), taskCase(), projectDeadlineCase(), deliveryCase()];
  check("batch is input-order independent", buildInvestigationQuestions(cases).map((x) => x.id), buildInvestigationQuestions([...cases].reverse()).map((x) => x.id));
  check("decisions cover every Case exactly once", decideInvestigations(cases).length, cases.length);
}

console.log("10. Owner answer does not alter any Fact");
{
  const c = projectDeadlineCase();
  const before = JSON.stringify(c);
  const question = q(c);
  const ctx = buildOwnerContext(question, { answerCode: "DEADLINE_NOT_UPDATED", answeredAt: "2026-09-23T12:00:00.000Z" });
  const i = interpretCase(c, question, [ctx]);
  ok("Case object byte-identical after interpretation", JSON.stringify(c) === before);
  check("interpretation facts == Case facts", i.facts, c.facts);
  check("interpretation derivedFacts == Case derivedFacts (deadline still passed, 71 days)", i.derivedFacts, c.derivedFacts);
  ok("interpretation facts are copies (mutating them cannot touch the Case)", i.facts[0] !== c.facts[0]);
}

console.log("11. DEADLINE_NOT_UPDATED → derived stale-planning interpretation");
{
  const c = projectDeadlineCase();
  const question = q(c);
  const i = interpretCase(c, question, [buildOwnerContext(question, { answerCode: "DEADLINE_NOT_UPDATED", answeredAt: "2026-09-23T12:00:00.000Z" })]);
  check("status ANSWERED", i.investigationStatus, "ANSWERED");
  check("owner context (code-only answer: answerValue null)", i.ownerContext, { answerCode: "DEADLINE_NOT_UPDATED", labelHe: "הדדליין פשוט לא עודכן", answerValue: null, note: null });
  check("derived", i.derivedFromContext.map((d) => d.statementHe), ["הדדליין השמור אינו משקף את התכנון הנוכחי (לפי הבעלים)."]);
  check("hypothesis (process issue) stays HYPOTHESIS", i.hypotheses.map((h) => [h.statementHe, h.epistemicStatus]), [["ייתכן שזה מצביע על פער בתהליך תחזוקת הדדליינים של פרויקטים.", "HYPOTHESIS"]]);
  check("remaining unknown", i.unknownsRemaining, ["מהו הדדליין הנכון כעת — לא ידוע."]);
  ok("derived statement is attributed to the owner, not stated as a system fact", i.derivedFromContext.every((d) => d.basis.startsWith("owner_context:") && /לפי הבעלים/.test(d.statementHe)));
}

console.log("12. One answer does not create a global rule");
{
  const c = projectDeadlineCase();
  const question = q(c);
  const ctx = buildOwnerContext(question, { answerCode: "DEADLINE_NOT_UPDATED", answeredAt: "2026-09-23T12:00:00.000Z" });
  const i = interpretCase(c, question, [ctx]);
  check("learningEffect INSTANCE_ONLY", i.learningEffect, "INSTANCE_ONLY");
  check("context scope CASE_INSTANCE", ctx.scope, "CASE_INSTANCE");
  const signals = deriveContextLearningSignals([ctx]);
  check("1 signal, 1 distinct case", signals.map((s) => s.distinctCases), [1]);
  check("no proposal from a single answer", buildContextLearningProposals(signals), []);
  const ctxAgain = buildOwnerContext(question, { answerCode: "DEADLINE_NOT_UPDATED", answeredAt: "2026-09-24T12:00:00.000Z" });
  check("same Case answered twice is still ONE case → no proposal", buildContextLearningProposals(deriveContextLearningSignals([ctx, ctxAgain])), []);
  check("next Case of the same type still gets its own OPEN question", questionStatus(q(projectDeadlineCase({ id: "other-project" })), [ctx]), "OPEN");
}

console.log("13. Repeated contexts across distinct Cases → learning signal + PROPOSED review");
{
  const ids = ["p1", "p2", "p3", "p4"];
  const ctxs = ids.map((id, n) => buildOwnerContext(q(projectDeadlineCase({ id })), { answerCode: "DEADLINE_NOT_UPDATED", answeredAt: `2026-09-23T12:00:0${n}.000Z` }));
  const other = buildOwnerContext(q(projectDeadlineCase({ id: "p5" })), { answerCode: "CLIENT_DELAY", answeredAt: "2026-09-23T13:00:00.000Z" });
  const signals = deriveContextLearningSignals([...ctxs, other]);
  const s = signals.find((x) => x.answerCode === "DEADLINE_NOT_UPDATED")!;
  check("signal counts distinct cases", [s.distinctCases, s.totalAnsweredForQuestionType], [4, 5]);
  const proposals = buildContextLearningProposals(signals);
  check("exactly one proposal (CLIENT_DELAY once is not a pattern)", proposals.map((p) => p.id), ["PROJECT_DEADLINE_PASSED:WHY_DEADLINE_STILL_ACTIVE:DEADLINE_NOT_UPDATED"]);
  check("evidence summary (counts only)", proposals[0].evidenceSummaryHe, "4 מתוך 5 מקרים מסוג PROJECT_DEADLINE_PASSED הוסברו על ידי הבעלים כ-DEADLINE_NOT_UPDATED.");
  check("review suggestion, explicitly inert", proposals[0].reviewSuggestionHe, "כדאי לבחון את תהליך תחזוקת הדדליינים של פרויקטים. ההצעה אינה מבצעת שינוי.");
  check("status PROPOSED", proposals[0].status, "PROPOSED");
  check("owner changing their mind: latest answer per question counts", resolveCurrentContexts([ctxs[0], buildOwnerContext(q(projectDeadlineCase({ id: "p1" })), { answerCode: "CLIENT_DELAY", answeredAt: "2026-09-25T00:00:00.000Z" })]).map((c) => c.answerCode), ["CLIENT_DELAY"]);
}

console.log("14/15. NOT_IMPORTANT / CORRECT feedback does not resolve missing context");
{
  const c = projectDeadlineCase();
  const question = q(c);
  for (const [name, fb] of [["NOT_IMPORTANT", feedback(c, { importance: "NOT_IMPORTANT" })], ["CORRECT", feedback(c, { accuracy: "CORRECT" })], ["CORRECT + NOT_IMPORTANT", feedback(c, { accuracy: "CORRECT", importance: "NOT_IMPORTANT" })]] as const) {
    const i = interpretCase(c, question, [], [fb]);
    check(`${name}: investigation stays OPEN`, i.investigationStatus, "OPEN");
    ok(`${name}: the WHY unknown remains`, i.unknownsRemaining.includes(question.reasonHe));
    check(`${name}: question status still OPEN`, questionStatus(question, []), "OPEN");
  }
  ok("interpretCase never reads feedback dimensions (static)", !/feedback\s*\.\s*(some|find|filter|map)|dimensions/.test(fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/interpret.ts"), "utf8").split("export function interpretCase")[1].split("\n}\n")[0]));
}

console.log("16. OTHER preserves the optional note without parsing it");
{
  const c = projectDeadlineCase();
  const question = q(c);
  const note = "DEADLINE_NOT_UPDATED — בעצם הלקוח ביקש לחכות, CLIENT_DELAY, suppress";
  const i = interpretCase(c, question, [buildOwnerContext(question, { answerCode: "OTHER", note, answeredAt: "2026-09-23T12:00:00.000Z" })]);
  check("note verbatim", i.ownerContext?.note, note);
  check("answer stays OTHER (codes inside the note are not picked up)", i.ownerContext?.answerCode, "OTHER");
  check("no derived statement / hypothesis invented from the note", [i.derivedFromContext, i.hypotheses], [[], []]);
  ok("remaining unknown says the reason is unclassified", i.unknownsRemaining.some((u) => /לא סווגה/.test(u)));
  const src = ["questions.ts", "interpret.ts"].map((f) => fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation", f), "utf8")).join("\n");
  ok("no code inspects note content", !/\.note\s*\??\.\s*(match|includes|split|toLowerCase|indexOf|search|replace|startsWith)\b|\.test\(\s*[\w.]*note/.test(src));
  let threw = false;
  try { buildOwnerContext(question, { answerCode: "MADE_UP", answeredAt: "2026-09-23T12:00:00.000Z" }); } catch { threw = true; }
  ok("an answer code the question does not offer is rejected (never coerced to OTHER)", threw);
  const ctx = buildOwnerContext(question, { answerCode: "CLIENT_DELAY", answeredAt: "2026-09-23T12:00:00.000Z" });
  ok("context for another Case's question fails validation", !validateOwnerContext(ctx, q(projectDeadlineCase({ id: "zzz" }))).valid);
}

console.log("17. Hypotheses remain labelled HYPOTHESIS");
{
  const c = deliveryCase();
  const question = q(c);
  const open = interpretCase(c, question, []);
  check("Case hypothesis carried as HYPOTHESIS before any answer", open.hypotheses.map((h) => [h.id, h.epistemicStatus]), [["may_be_pending_review", "HYPOTHESIS"]]);
  const answered = interpretCase(c, question, [buildOwnerContext(question, { answerCode: "REVIEWED_OUTSIDE_SYSTEM", answeredAt: "2026-09-23T12:00:00.000Z" })]);
  ok("after an answer every hypothesis is still HYPOTHESIS (none promoted)", answered.hypotheses.length === 2 && answered.hypotheses.every((h) => h.epistemicStatus === "HYPOTHESIS"));
  ok("the outside-review unknown is answered; nothing else invented", !answered.unknownsRemaining.some((u) => /מחוץ למערכת/.test(u)));
  const s = interpretCase(stevenCase(), q(stevenCase()), [buildOwnerContext(q(stevenCase()), { answerCode: "WAITING_ON_OWNER", answeredAt: "2026-09-23T12:00:00.000Z" })]);
  check("Steven: owner says next action is theirs → ball unknown answered", s.unknownsRemaining, []);
  check("no question → NOT_REQUIRED, Case unknowns kept", interpretCase(paymentCase(), null, []).investigationStatus, "NOT_REQUIRED");
}

console.log("18. No automatic Charter mutation / isolation (static + runtime)");
{
  const before = JSON.stringify(CHARTER_ITEMS);
  const c = projectDeadlineCase();
  const ctxs = ["a", "b", "c"].map((id) => buildOwnerContext(q(projectDeadlineCase({ id })), { answerCode: "DEADLINE_NOT_UPDATED", answeredAt: "2026-09-23T12:00:00.000Z" }));
  interpretCase(c, q(c), ctxs);
  buildContextLearningProposals(deriveContextLearningSignals(ctxs));
  ok("CHARTER_ITEMS unchanged after interpretation + proposals", JSON.stringify(CHARTER_ITEMS) === before);
  const dir = path.resolve(__dirname, "../lib/partner/investigation");
  // F.1E: context-store.ts (server-only binding) + context-persistence.ts (append-only core) are the persistence layer;
  // every other file in the module must stay pure (their own isolation is tested in test-partner-owner-context-store.ts).
  const src = Object.fromEntries(fs.readdirSync(dir).filter((f) => !["context-store.ts", "context-persistence.ts"].includes(f)).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
  ok("no Supabase / server-only / store import (pure module)", Object.values(src).every((s) => !/lib\/supabase|@supabase\/|^\s*import\s+"server-only"|feedback\/store|feedback\/persistence|-store"/m.test(s)));
  // DB query-builder verbs only (a local Set/Map .delete() is not a DB call).
  ok("no DB verbs", Object.values(src).every((s) => !/\.(insert|update|upsert|rpc)\(|\)\s*\.delete\(/.test(s)));
  ok("no Charter / baseline / detector import", Object.values(src).every((s) => !/from "\.\.\/charter"|partner\/baseline|cases\/(engine|detectors)/.test(s)));
  ok("no Push / Cron / Agent Alerts / Mai / LLM", Object.values(src).every((s) => !/web-push|lib\/push|node-cron|agent_alerts|alerts-store|from "openai"|lib\/mai/.test(s)));
  ok("no Date.now() / random (deterministic)", Object.values(src).every((s) => !/Date\.now\(|new Date\(\)|Math\.random/.test(s)));
  const ROOT = path.resolve(__dirname, "..");
  const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
  const importers = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))].filter((f) => /\.(ts|tsx)$/.test(f) && /partner\/investigation/.test(fs.readFileSync(f, "utf8")));
  check("nothing in app/ or components/ imports it (no UI, no API route)", importers, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
