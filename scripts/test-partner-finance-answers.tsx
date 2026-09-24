/**
 * Tests — Redbloods Partner Finance Owner Context Loop (F2.8–F2.10).
 *
 * Run with:   npx tsx scripts/test-partner-finance-answers.tsx
 *
 * NEVER touches production: the real finance brain / integrity / answer core / Owner Context store run
 * against the shared production mirror + an in-memory partner_owner_context fake; the real POST route and
 * the real server binding run in-process with requireOwner / getAuthUser / the store binding / the live
 * loader faked; the UI is rendered with react-dom/server; boundaries are checked statically.
 *
 * ASK → ANSWER → PERSIST (append-only Owner Context) → CONSUME (OWNER_DECISION) → the question disappears
 * or changes. Owner answers never change realized cash / receivables / open expenses / forecasts.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest, NextResponse } from "next/server";
import { buildFinanceBrain } from "../lib/partner/finance/core";
import { buildFinanceBrief, QUESTIONS_UNAVAILABLE_HE } from "../lib/partner/finance/brief";
import { buildFinanceIntegrity, INTEGRITY_SCHEMA_VERSION, RESOLVING_ANSWERS, type OwnerQuestion } from "../lib/partner/finance/integrity";
import { financeAnswersFromContexts, financeCaseId, financeQuestionFingerprint, type FinanceOwnerAnswer } from "../lib/partner/finance/owner-answers";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { answerFinanceQuestionCore, createRequestLedger, validateFinanceAnswerInput, type FinanceAnswerDeps } from "../lib/partner/finance/answer";
import { parseFinanceBriefResponse, FINANCE_BRIEF_DTO_VERSION, FINANCE_QUESTION_ID_RE, type FinanceBriefDto, type FinanceRehabQuestionDto } from "../lib/partner/finance/dto";
import { FINANCE_ANSWER_OPTIONS, FINANCE_QUESTION_TYPES, isFinanceQuestionType } from "../lib/partner/investigation/finance-questions";
import { ANSWER_OPTIONS, answerOptionsFor, isFollowUpQuestionType, decideInvestigation, resolveAnswerValue, VALUE_SPEC } from "../lib/partner/investigation";
import { createOwnerContextStore, buildOwnerContextDraft, analyzeOwnerContextGraph } from "../lib/partner/investigation/context-persistence";
import { isAnswerCodeValidFor, isKnownQuestionType, mapOwnerContextRow } from "../lib/partner/investigation/context-row";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { PartnerActionsView } from "../components/partner/PartnerActionCard";
import type { FinanceAnswerControls } from "../components/partner/PartnerFinanceBrief";
import { buildFinanceAnswerAttempt, interpretFinanceAnswerResponse, FINANCE_ANSWER_URL, FINANCE_STALE_MESSAGE_HE } from "../components/partner/partner-finance-answer-client";
import { isAviAllowedPath, isCleantoneAllowedPath, isShalevAllowedPath, isStevenAllowedPath, isVictorAllowedPath } from "../lib/roles";
import { empty, project, productionMirror, tx, withPrice } from "./fixtures/finance-mirror";
import { FakeOwnerContextDb } from "./fixtures/owner-context-fake";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const NOW = new Date("2026-09-24T09:00:00Z"); // Israel date 2026-09-24
const ACTOR = "11111111-2222-4333-8444-555555555555";
const RAW0 = productionMirror();
const clone = (r: FinanceRaw): FinanceRaw => JSON.parse(JSON.stringify(r));

/** The production composition (view.ts): overlay + readiness + injected payment-date question. */
function derive(raw: FinanceRaw, answers: readonly FinanceOwnerAnswer[] = [], opts: { answersAvailable?: boolean } = {}) {
  const v = deriveFinanceView(raw, NOW, answers);
  return { state: v.state, integrity: v.integrity, actions: v.actions, brief: buildFinanceBrief(v.state, v.integrity, { ...opts, actionNoteHe: v.actionNoteHe }) };
}
/** The money view that Owner answers must NEVER change. */
const money = (d: ReturnType<typeof derive>) => JSON.stringify({ realized: d.state.realized, receivables: d.state.receivables, openExpenses: d.state.openExpenses, expected: d.state.expected, pacing: d.state.pacing, recurring: d.state.recurring, summary: d.brief.summary });

// ── harness: real core + real store over the in-memory table ──
function harness(initialRaw: FinanceRaw = RAW0) {
  const db = new FakeOwnerContextDb();
  const store = createOwnerContextStore(db.client(), { now: () => NOW });
  const ref = { raw: initialRaw, liveFails: false };
  const calls = { live: 0, append: 0 };
  const audits: Array<{ event: string; data: Record<string, unknown> }> = [];
  const activeAnswers = async () => { const r = await store.resolveCurrentOwnerContexts(); if (r.status === "OK") return financeAnswersFromContexts(r.contexts); if (r.status === "NO_CONTEXT") return []; throw new Error(r.status); };
  const mkDeps = (ledger = createRequestLedger()): FinanceAnswerDeps => ({
    async loadLive() {
      calls.live++;
      if (ref.liveFails) return { ok: false, detail: "finance read failed" };
      const answers = await activeAnswers();
      return { ok: true, integrity: derive(ref.raw, answers).integrity, answers };
    },
    async appendOwnerContext(d) { calls.append++; return store.appendOwnerContext(d); },
    ledger,
    audit: (event, data) => audits.push({ event, data }),
  });
  const deps = mkDeps();
  const view = async () => derive(ref.raw, await activeAnswers());
  const q = async (type: string) => (await view()).integrity.top.questions.find((x) => x.questionType === type) ?? null;
  const answer = (b: unknown, d: FinanceAnswerDeps = deps) => answerFinanceQuestionCore(d, ACTOR, b);
  return { db, store, ref, calls, audits, mkDeps, deps, view, q, answer, activeAnswers };
}
const bodyFor = (q: OwnerQuestion, answerCode: string, extra: Record<string, unknown> = {}) => ({ questionId: q.identity!.questionId, answerCode, seenQuestionFingerprint: q.identity!.fingerprint, requestId: randomUUID(), ...extra });

// A real Partner Case question (non-finance Owner Context coexisting in the same table).
function projectDeadlineCase(pid = "10d23186-a5ab-4eed-a9a4-eeda221a34d5"): PartnerCase {
  return {
    id: `project_deadline_passed:${pid}`, schemaVersion: CASE_SCHEMA_VERSION, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: pid,
    classification: "RISK", status: "OPEN", createdFrom: "STATE",
    facts: [{ domain: "projects", entityId: pid, field: "deadline", value: "2026-07-14", label: "deadline" }, { domain: "projects", entityId: pid, field: "status", value: "במיקס", label: "status" }],
    derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: 71, basis: "x" }, { id: "days_since_update", label: "x", value: 1, basis: "x" }, { id: "activity_after_deadline", label: "x", value: true, basis: "x" }],
    hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
    interventionStyle: "GENTLE", summaryHe: "", changeContext: null,
  } as PartnerCase;
}

// ── in-process route / binding fakes ──
const auth = { role: "owner" as "owner" | "none" | "victor", userId: ACTOR as string | null };
const routeFake = { calls: 0, input: null as unknown, result: { status: "ANSWER_SAVED", contextId: "x", supersedesId: null } as Record<string, unknown> };
const svc = { live: null as unknown, appendCalls: 0, h: null as ReturnType<typeof harness> | null };
const ML = Module as unknown as { _load(request: string, parent: { filename?: string } | null, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: { filename?: string } | null, isMain: boolean) {
  const from = parent?.filename ?? "";
  if (request === "server-only") return {};
  if (/lib\/require-auth$/.test(request)) return {
    async requireOwner() { return auth.role === "owner" ? null : NextResponse.json({ error: "x" }, { status: auth.role === "none" ? 401 : 403 }); },
    async getAuthUser() { return auth.userId ? { id: auth.userId } : null; },
  };
  if (/finance\/answer-service$/.test(request) && /answer[\\/]route\.ts$/.test(from)) return { async answerFinanceQuestion(i: unknown) { routeFake.calls++; routeFake.input = i; return routeFake.result; } };
  if (/investigation\/context-store$/.test(request) && /answer-service\.ts$/.test(from)) return { async appendOwnerContext(d: never) { svc.appendCalls++; return svc.h!.store.appendOwnerContext(d); } };
  if (/^\.\/server$/.test(request) && /answer-service\.ts$/.test(from)) return { async loadFinanceLive() { return svc.live; } };
  return origLoad.call(this, request, parent, isMain);
};
const GOOD = { "content-type": "application/json", origin: "https://app.example", host: "app.example", "sec-fetch-site": "same-origin" };
const post = async (route: { POST(r: NextRequest): Promise<Response> }, body: unknown, headers: Record<string, string> = GOOD) => {
  const res = await route.POST(new NextRequest("https://app.example/api/partner/finance/answer", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, unknown>, cache: res.headers.get("cache-control") };
};

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  console.log("Phase 0 / taxonomy (1-10)");
  {
    check("1. finance question types (six + F2.11 payment date)", [...FINANCE_QUESTION_TYPES], ["FINANCE_RECURRING_PAYMENT_STATUS", "FINANCE_RECEIVABLE_TIMING", "FINANCE_COMPLETED_PROJECT_INCOME_STATUS", "FINANCE_ORPHAN_SETTING_MEANING", "FINANCE_EXPENSE_RECURRENCE", "FINANCE_OVERDUE_REASON", "FINANCE_PAYMENT_DATE"]);
    const codes = (t: keyof typeof FINANCE_ANSWER_OPTIONS) => FINANCE_ANSWER_OPTIONS[t].map((o) => o.code);
    check("2. Victor / recurring payment answers", codes("FINANCE_RECURRING_PAYMENT_STATUS"), ["PAID_NEEDS_RECORDING", "NOT_PAID", "UNKNOWN"]);
    check("3. receivable timing = collection intent windows (+ optional exact date)", codes("FINANCE_RECEIVABLE_TIMING"), ["THIS_WEEK", "BY_MONTH_END", "NEXT_MONTH", "EXACT_DATE", "NOT_EXPECTED", "PROJECT_CANCELLED_NO_FURTHER_PAYMENT", "UNKNOWN"]);
    check("4. completed project answers", codes("FINANCE_COMPLETED_PROJECT_INCOME_STATUS"), ["INCOME_RECEIVED_NOT_RECORDED", "INCOME_NOT_RECEIVED", "NON_PAID_PROJECT", "OTHER", "UNKNOWN"]);
    check("5. orphan / recurrence / overdue answers", [codes("FINANCE_ORPHAN_SETTING_MEANING"), codes("FINANCE_EXPENSE_RECURRENCE"), codes("FINANCE_OVERDUE_REASON")], [["HISTORICAL_ONLY", "REAL_DEAL_NEEDS_RECOVERY", "UNKNOWN"], ["RECURRING", "ONE_TIME", "UNKNOWN"], ["WAITING_FOR_CLIENT", "PROMISED_NEW_DATE", "DISPUTE", "WAITING_FOR_DELIVERY", "OWNER_AGREED_DELAY", "OTHER", "UNKNOWN"]]);
    ok("6. finance types join the persisted taxonomy (strict row parser accepts them)", FINANCE_QUESTION_TYPES.every((t) => isKnownQuestionType(t) && Object.prototype.hasOwnProperty.call(ANSWER_OPTIONS, t)));
    ok("7. finance answer sets are complete as-is — no generic OTHER appended (Victor rejects OTHER)", FINANCE_QUESTION_TYPES.every((t) => JSON.stringify(answerOptionsFor(t).map((o) => o.code)) === JSON.stringify(codes(t))) && !isAnswerCodeValidFor("FINANCE_RECURRING_PAYMENT_STATUS", "OTHER") && isAnswerCodeValidFor("FINANCE_COMPLETED_PROJECT_INCOME_STATUS", "OTHER"));
    ok("8. Case questions keep their OTHER option (investigation unchanged)", answerOptionsFor("WHY_DEADLINE_STILL_ACTIVE").some((o) => o.code === "OTHER"));
    check("9. only EXACT_DATE carries a value (explicit, not in the past); every window is code-only", [VALUE_SPEC.FINANCE_RECEIVABLE_TIMING, resolveAnswerValue("FINANCE_RECEIVABLE_TIMING", "BY_MONTH_END", { anchorYmd: "2026-09-24" }), resolveAnswerValue("FINANCE_RECEIVABLE_TIMING", "EXACT_DATE", { anchorYmd: "2026-09-24", explicitYmd: "2026-09-20" }).ok], [{ EXACT_DATE: { kind: "DATE_EXPLICIT", notBeforeAnchor: true } }, { ok: true, value: null }, false]);
    ok("10. finance questions are never follow-ups and never come from a Case", FINANCE_QUESTION_TYPES.every((t) => !isFollowUpQuestionType(t)) && !/FINANCE_/.test(rd("lib/partner/investigation/questions.ts").split("export const ANSWER_OPTIONS")[1].split("export function buildInvestigationQuestions")[1] ?? ""));
  }

  console.log("Identity + fingerprint (11-20)");
  const base = derive(RAW0);
  const [qVictor, qBal] = base.integrity.top.questions;
  {
    check("11. production mirror surfaces 2 answerable questions (Victor, ₪1,600 balance)", base.integrity.top.questions.map((q) => [q.questionType, !!q.identity]), [["FINANCE_RECURRING_PAYMENT_STATUS", true], ["FINANCE_RECEIVABLE_TIMING", true]]);
    check("12. deterministic case id per issue + subject", qVictor.identity!.caseId, "finance:EXPENSE_EXPECTED_BUT_NOT_FOUND:recurring:VICTOR_SALARY:2026-08");
    check("13. question id = case id :: question type", qVictor.identity!.questionId, `${qVictor.identity!.caseId}::FINANCE_RECURRING_PAYMENT_STATUS`);
    ok("14. ids match the strict DTO / validation pattern", FINANCE_QUESTION_ID_RE.test(qVictor.identity!.questionId) && FINANCE_QUESTION_ID_RE.test(qBal.identity!.questionId));
    const again = derive(RAW0);
    check("15. same facts → same id + fingerprint", again.integrity.top.questions.map((q) => [q.identity!.questionId, q.identity!.fingerprint]), base.integrity.top.questions.map((q) => [q.identity!.questionId, q.identity!.fingerprint]));
    ok("16. fingerprint is 64 lowercase hex", /^[0-9a-f]{64}$/.test(qVictor.identity!.fingerprint));
    const pid = qBal.subject.id.split(":")[1];
    const raw2 = clone(RAW0); (raw2.financeSettings.find((s) => s.projectId === pid)!.value as Record<string, unknown>).agreedPrice = 3400;
    const q2 = derive(raw2).integrity.top.questions.find((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING")!;
    ok("17. changed facts (balance ₪1,600 → ₪1,800) → same question id, NEW fingerprint", q2.identity!.questionId === qBal.identity!.questionId && q2.identity!.fingerprint !== qBal.identity!.fingerprint);
    const fp = (o: Partial<Parameters<typeof financeQuestionFingerprint>[0]>) => financeQuestionFingerprint({ questionType: "FINANCE_RECEIVABLE_TIMING", issueType: "X", subject: { type: "receivable", id: "r", labelHe: null }, textHe: "t", optionCodes: ["A", "B"], amount: 1, currency: "₪", date: null, evidence: [{ sourceType: "project", sourceId: "p", reasonCode: "R" }], ...o });
    ok("18. fingerprint covers wording, options, amount and evidence ids", new Set([fp({}), fp({ textHe: "t2" }), fp({ optionCodes: ["A"] }), fp({ amount: 2 }), fp({ evidence: [{ sourceType: "project", sourceId: "q", reasonCode: "R" }] })]).size === 5);
    ok("19. evidence order / volatile evidence fields do not change the fingerprint", fp({ evidence: [{ sourceType: "project", sourceId: "p", reasonCode: "R", status: "x", date: "2026-01-01" }] }) === fp({}));
    check("20. display-only questions have no identity (never answerable)", base.integrity.questions.filter((q) => !isFinanceQuestionType(q.questionType)).every((q) => q.identity === null), true);
  }

  console.log("Answer → persist → consume (21-40)");
  {
    const h = harness();
    const non = decideInvestigation(projectDeadlineCase()).question!;
    const other = await h.store.appendOwnerContext(buildOwnerContextDraft(non, CASE_SCHEMA_VERSION, { answerCode: "DEADLINE_NOT_UPDATED" }));
    const before = derive(RAW0);
    const qV = (await h.q("FINANCE_RECURRING_PAYMENT_STATUS"))!;
    const b = bodyFor(qV, "PAID_NEEDS_RECORDING");
    const r = await h.answer(b);
    check("21. Victor → PAID_NEEDS_RECORDING saved", r.status, "ANSWER_SAVED");
    check("22. exactly one new partner_owner_context row (next to the unrelated Case answer)", h.db.rows.length, 2);
    const row = h.db.rows[1];
    check("23. row identity", [row.question_type, row.case_id, row.case_type, row.subject_type, row.subject_id], ["FINANCE_RECURRING_PAYMENT_STATUS", qV.identity!.caseId, "EXPENSE_EXPECTED_BUT_NOT_FOUND", "recurring", "VICTOR_SALARY:2026-08"]);
    check("24. provenance unchanged (owner_manual only), scope CASE_INSTANCE, no trigger, no supersedes, no note", [row.provenance, row.scope, row.trigger_context_id, row.supersedes_id, row.note], [{ source: "owner_manual" }, "CASE_INSTANCE", null, null, null]);
    check("25. schema version / fingerprint / wording carried in existing columns", [row.case_schema_version, row.case_facts_fingerprint, row.question_text, row.answer_value], [INTEGRITY_SCHEMA_VERSION, qV.identity!.fingerprint, qV.textHe, null]);
    ok("26. the stored row passes the strict fail-closed row parser", mapOwnerContextRow(row).ok);
    check("27. audit carries the session actor + requestId (never from the input)", [h.audits[0].event, h.audits[0].data.actorUserId, h.audits[0].data.requestId], ["partner_finance_answer", ACTOR, b.requestId]);
    const after = await h.view();
    ok("28. the Victor question is no longer asked", !after.integrity.top.questions.some((q) => q.questionType === "FINANCE_RECURRING_PAYMENT_STATUS") && !after.integrity.questions.some((q) => q.questionType === "FINANCE_RECURRING_PAYMENT_STATUS"));
    const line = after.brief.rehab.items.find((i) => i.issueType === "EXPENSE_EXPECTED_BUT_NOT_FOUND");
    check("29. missing-record signal kept, reworded as the Owner's statement (OWNER_DECISION)", [line?.epistemic, line?.textHe], ["OWNER_DECISION", "משכורת Victor עבור אוגוסט 2026: שולם לפי מה שאמרת, ועדיין חסר רישום בכספים."]);
    ok("30. realized cash in / out / net, receivables, open expenses, expected, pacing: unchanged", money(after) === money(before));
    check("31. answers applied: 1 (the Case answer is ignored by finance)", [after.integrity.ownerAnswers.applied, (await h.activeAnswers()).map((a) => a.questionType)], [1, ["FINANCE_RECURRING_PAYMENT_STATUS"]]);
    ok("32. the unrelated Case answer is untouched", JSON.stringify(h.db.rows[0]) === JSON.stringify(h.db.rows.find((x) => x.id === other.id)));
    ok("33. a finance case id can never collide with a Partner Case id", !/^finance:/.test(projectDeadlineCase().id) && financeCaseId("X", "y", "z").startsWith("finance:"));
    ok("34. revision graph stays valid", analyzeOwnerContextGraph((await h.store.listOwnerContexts() as { contexts: never[] }).contexts).length === 0);

    // next surfaced question is the one-at-a-time completed-project question
    const nextTypes = after.integrity.top.questions.map((q) => q.questionType);
    check("35. next ask: the ONE missing fact of the confirmed repair (payment date) first, then balance timing (max 2)", nextTypes, ["FINANCE_PAYMENT_DATE", "FINANCE_RECEIVABLE_TIMING"]);

    // receivable timing: window answer
    const qB = (await h.q("FINANCE_RECEIVABLE_TIMING"))!;
    check("36. timing → BY_MONTH_END saved as a window (no date value)", [(await h.answer(bodyFor(qB, "BY_MONTH_END"))).status, h.db.rows[2].answer_value], ["ANSWER_SAVED", null]);
    const v3 = await h.view();
    check("37. timing line is the Owner's collection intent, never a recorded due date", v3.brief.rehab.items.find((i) => i.issueType === "RECEIVABLE_DUE_DATE_MISSING")?.textHe, "יתרה של ₪1,600 בפרויקט 'פרויקט': לפי מה שאמרת צפויה להיכנס עד סוף החודש.");
    ok("38. no forecast contamination: receivable due date stays null, known month-end position unchanged", v3.state.receivables.find((x) => x.id === qB.subject.id)!.dueDate === null && money(v3) === money(before));

    // completed project: NON_PAID_PROJECT closes the gap
    const qC = (await h.q("FINANCE_COMPLETED_PROJECT_INCOME_STATUS"))!;
    check("39. completed project → NON_PAID_PROJECT saved", (await h.answer(bodyFor(qC, "NON_PAID_PROJECT"))).status, "ANSWER_SAVED");
    const v4 = await h.view();
    const closed = v4.integrity.issues.find((i) => i.subjectId === qC.subject.id && i.issueType === "COMPLETED_WORK_NO_INCOME")!;
    ok("40. the gap is closed (kept for audit), the count drops 8 → 7, the next project is asked", closed.ownerResolved === true && v4.integrity.trust.completedWorkIncome.reason === "COMPLETED_NO_INCOME_7" && v4.brief.rehab.items.some((i) => i.textHe.startsWith("7 פרויקטים")) && v4.integrity.top.questions.some((q) => q.questionType === "FINANCE_COMPLETED_PROJECT_INCOME_STATUS" && q.subject.id !== qC.subject.id) && money(v4) === money(before));
  }

  console.log("Stale / replay / conflict / validation (41-62)");
  {
    const h = harness();
    const qV = (await h.q("FINANCE_RECURRING_PAYMENT_STATUS"))!;
    const b = bodyFor(qV, "NOT_PAID");
    const [r1, r2] = await Promise.all([h.answer(b), h.answer(b)]);
    check("41. double click (same requestId, in flight) → one write: SAVED + REPLAY", [r1.status, r2.status, h.db.rows.length], ["ANSWER_SAVED", "REPLAY", 1]);
    check("42. exact replay later → REPLAY, no write", [(await h.answer(b)).status, h.db.rows.length], ["REPLAY", 1]);
    check("43. same requestId, different answer → REQUEST_ID_CONFLICT, no write", [(await h.answer({ ...b, answerCode: "UNKNOWN" })).status, h.db.rows.length], ["REQUEST_ID_CONFLICT", 1]);
    const restarted = h.mkDeps(createRequestLedger());
    check("44. after a server restart (empty ledger) the same request → REPLAY from the stored answer, no write", [(await h.answer(b, restarted)).status, h.db.rows.length], ["REPLAY", 1]);
    check("45. after a restart, a different answer to an answered question → STALE_QUESTION, no write", [(await h.answer({ ...b, requestId: randomUUID(), answerCode: "UNKNOWN" }, restarted)).status, h.db.rows.length], ["STALE_QUESTION", 1]);
    const v = await h.view();
    check("46. NOT_PAID → an OWNER_DECISION obligation, never an open-expense / forecast change", [v.integrity.ownerAnswers.obligations.map((o) => [o.basis, o.amount, o.currency]), v.state.openExpenses.totalsByCurrency, v.brief.rehab.items[0].textHe], [[["OWNER_DECISION", 550, "$"]], derive(RAW0).state.openExpenses.totalsByCurrency, "משכורת Victor עבור אוגוסט 2026: לפי מה שאמרת עדיין לא שולמה — התחייבות פתוחה של $550."]);

    const h2 = harness();
    const qB = (await h2.q("FINANCE_RECEIVABLE_TIMING"))!;
    check("47. stale fingerprint → STALE_QUESTION, no write", [(await h2.answer({ ...bodyFor(qB, "THIS_WEEK"), seenQuestionFingerprint: "0".repeat(64) })).status, h2.db.rows.length], ["STALE_QUESTION", 0]);
    check("48. an answer code the question does not offer → STALE_QUESTION", [(await h2.answer(bodyFor(qB, "PAID_NEEDS_RECORDING"))).status, (await h2.answer(bodyFor(qB, "OTHER"))).status, h2.db.rows.length], ["STALE_QUESTION", "STALE_QUESTION", 0]);
    check("49. unknown / not-surfaced question → STALE_QUESTION", [(await h2.answer({ ...bodyFor(qB, "THIS_WEEK"), questionId: "finance:ORPHAN_FINANCE_SETTING:finance_setting:nope::FINANCE_ORPHAN_SETTING_MEANING" })).status, h2.db.rows.length], ["STALE_QUESTION", 0]);
    const orphanQ = base.integrity.issues.find((i) => i.issueType === "ORPHAN_FINANCE_SETTING")!.recommendedOwnerQuestion!;
    check("50. a real but NOT surfaced question cannot be answered (only what the Owner sees)", [(await h2.answer(bodyFor(orphanQ, "HISTORICAL_ONLY"))).status, h2.db.rows.length], ["STALE_QUESTION", 0]);

    const liveBefore = h2.calls.live;
    const bad: Array<[string, unknown]> = [
      ["extra key", { ...bodyFor(qB, "THIS_WEEK"), note: "x" }],
      ["supersedesId from the client", { ...bodyFor(qB, "THIS_WEEK"), supersedesId: randomUUID() }],
      ["actor from the client", { ...bodyFor(qB, "THIS_WEEK"), actorUserId: ACTOR }],
      ["fingerprint not hex", { ...bodyFor(qB, "THIS_WEEK"), seenQuestionFingerprint: "xyz" }],
      ["requestId uppercase", { ...bodyFor(qB, "THIS_WEEK"), requestId: randomUUID().toUpperCase() }],
      ["requestId missing", (({ requestId, ...rest }) => { void requestId; return rest; })(bodyFor(qB, "THIS_WEEK"))],
      ["EXACT_DATE without a date", bodyFor(qB, "EXACT_DATE")],
      ["a date on a window answer", bodyFor(qB, "THIS_WEEK", { exactDateYmd: "2026-10-01" })],
      ["impossible date", bodyFor(qB, "EXACT_DATE", { exactDateYmd: "2026-02-30" })],
      ["not a finance question id", { ...bodyFor(qB, "THIS_WEEK"), questionId: "project_deadline_passed:x::WHY_DEADLINE_STILL_ACTIVE" }],
      ["answer code format", bodyFor(qB, "this_week")],
      ["array body", []],
    ];
    for (const [name, x] of bad) check(`51. INVALID_INPUT: ${name}`, (await h2.answer(x)).status, "INVALID_INPUT");
    check("52. invalid input never reads the live state nor writes", [h2.calls.live - liveBefore, h2.calls.append, h2.db.rows.length], [0, 0, 0]);

    const past = await h2.answer(bodyFor(qB, "EXACT_DATE", { exactDateYmd: "2026-09-20" }));
    check("53. EXACT_DATE in the past → INVALID_INPUT from the store, no write", [past.status, h2.db.rows.length], ["INVALID_INPUT", 0]);
    const ex = await h2.answer(bodyFor(qB, "EXACT_DATE", { exactDateYmd: "2026-10-05" }));
    const av = h2.db.rows[0]?.answer_value as { kind: string; ymd: string; resolution: { method: string; anchorYmd: string } } | undefined;
    check("54. EXACT_DATE → explicit DATE value, anchored on today's Israel date", [ex.status, av?.kind, av?.ymd, av?.resolution.method, av?.resolution.anchorYmd], ["ANSWER_SAVED", "DATE", "2026-10-05", "EXPLICIT", "2026-09-24"]);
    check("55. exact date shown as the Owner's statement", (await h2.view()).brief.rehab.items.find((i) => i.issueType === "RECEIVABLE_DUE_DATE_MISSING")?.textHe, "יתרה של ₪1,600 בפרויקט 'פרויקט': לפי מה שאמרת צפויה להיכנס ב־05.10.2026.");

    // concurrent first answers from two different requests → exactly one root
    const h3 = harness();
    const qB3 = (await h3.q("FINANCE_RECEIVABLE_TIMING"))!;
    const [c1, c2] = await Promise.all([h3.answer(bodyFor(qB3, "THIS_WEEK")), h3.answer(bodyFor(qB3, "NEXT_MONTH"))]);
    check("56. two different concurrent answers → one saved, the other STALE_QUESTION (one root per slot)", [[c1.status, c2.status].sort(), h3.db.rows.length], [["ANSWER_SAVED", "STALE_QUESTION"], 1]);

    // failures
    const h4 = harness();
    const qV4 = (await h4.q("FINANCE_RECURRING_PAYMENT_STATUS"))!;
    const fb = bodyFor(qV4, "UNKNOWN");
    h4.db.opts.failInsert = true;
    check("57. DB write failure → FAILED (nothing stored)", [(await h4.answer(fb)).status, h4.db.rows.length], ["FAILED", 0]);
    h4.db.opts.failInsert = false;
    check("58. a failed attempt may be retried with the SAME requestId", [(await h4.answer(fb)).status, h4.db.rows.length], ["ANSWER_SAVED", 1]);
    h4.ref.liveFails = true;
    check("59. live read failure → LIVE_READ_FAILED, no write", [(await h4.answer(bodyFor(qV4, "UNKNOWN"))).status, h4.db.rows.length], ["LIVE_READ_FAILED", 1]);
    h4.ref.liveFails = false;
    h4.db.opts.failSelect = true;
    let threw = false; try { await h4.view(); } catch { threw = true; }
    ok("60. an unreadable Owner Context is never treated as 'no answers'", threw);
    h4.db.opts.failSelect = false;
    const hidden = derive(RAW0, [], { answersAvailable: false }).brief;
    check("61. brief with unreadable answers: questions hidden with a note (never re-asked blindly)", [hidden.rehab.questions.length, hidden.rehab.questionsNoteHe], [0, QUESTIONS_UNAVAILABLE_HE]);
    ok("62. validateFinanceAnswerInput is strict about keys", !validateFinanceAnswerInput({ questionId: "x" }).ok);
  }

  console.log("Revision (63-70)");
  {
    const h = harness();
    const q1 = (await h.q("FINANCE_RECEIVABLE_TIMING"))!;
    const first = await h.answer(bodyFor(q1, "NEXT_MONTH"));
    const pid = q1.subject.id.split(":")[1];
    const raw2 = clone(RAW0); (raw2.financeSettings.find((s) => s.projectId === pid)!.value as Record<string, unknown>).agreedPrice = 3400;
    h.ref.raw = raw2;
    const v = await h.view();
    const q2 = v.integrity.top.questions.find((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING")!;
    check("63. facts changed → the old answer no longer applies; the question is asked again", [v.integrity.ownerAnswers.applied, v.integrity.ownerAnswers.outdated, !!q2], [0, 1, true]);
    check("64. the earlier answer is shown as history on the re-asked question", v.brief.rehab.questions.find((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING")?.answer?.previousAnswerHe, "ענית בעבר: בחודש הבא. הנתונים השתנו מאז.");
    check("65. an answer to the OLD fingerprint → STALE_QUESTION", (await h.answer(bodyFor(q1, "THIS_WEEK"))).status, "STALE_QUESTION");
    const second = await h.answer(bodyFor(q2, "THIS_WEEK"));
    check("66. new answer = append-only REVISION (supersedes the old one, chosen by the server)", [second.status, second.status === "ANSWER_SAVED" ? second.supersedesId : null, h.db.rows.length, h.db.rows[1].supersedes_id], ["ANSWER_SAVED", first.status === "ANSWER_SAVED" ? first.contextId : "?", 2, h.db.rows[0].id]);
    const active = await h.activeAnswers();
    check("67. the latest revision is the active answer", active.map((a) => [a.answerCode, a.contextId]), [["THIS_WEEK", h.db.rows[1].id]]);
    ok("68. the old row is untouched (append-only)", h.db.rows[0].answer_code === "NEXT_MONTH" && h.db.rows[0].supersedes_id === null);
    ok("69. revision graph valid (no branch, same target)", analyzeOwnerContextGraph((await h.store.listOwnerContexts() as { contexts: never[] }).contexts).length === 0);
    check("70. re-answered question disappears again", (await h.view()).integrity.top.questions.some((q) => q.questionType === "FINANCE_RECEIVABLE_TIMING"), false);
  }

  console.log("Consumption per answer type (71-84) — pure, injected answers");
  {
    const before = derive(RAW0);
    const asAnswer = (q: OwnerQuestion, code: string, ymd: string | null = null): FinanceOwnerAnswer => ({ contextId: randomUUID(), questionId: q.identity!.questionId, questionType: q.questionType as FinanceOwnerAnswer["questionType"], caseId: q.identity!.caseId, caseType: q.identity!.issueType, subjectType: q.subject.type, subjectId: q.subject.id, answerCode: code, answerValueYmd: ymd, factsFingerprint: q.identity!.fingerprint, answeredAt: NOW.toISOString() });
    const issueQ = (type: string, d = before) => d.integrity.issues.find((i) => i.recommendedOwnerQuestion?.questionType === type)!.recommendedOwnerQuestion!;
    const orphan = issueQ("FINANCE_ORPHAN_SETTING_MEANING");
    const oHist = derive(RAW0, [asAnswer(orphan, "HISTORICAL_ONLY")]);
    ok("71. orphan HISTORICAL_ONLY closes that orphan (never money)", oHist.integrity.issues.find((i) => i.subjectId === orphan.subject.id && i.issueType === "ORPHAN_FINANCE_SETTING")!.ownerResolved === true && oHist.integrity.trust.orphanPriceData.reason === "ORPHANS_8" && money(oHist) === money(before));
    const oReal = derive(RAW0, [asAnswer(orphan, "REAL_DEAL_NEEDS_RECOVERY")]);
    ok("72. orphan REAL_DEAL_NEEDS_RECOVERY stays open, still excluded from money", oReal.integrity.issues.find((i) => i.subjectId === orphan.subject.id && i.issueType === "ORPHAN_FINANCE_SETTING")!.ownerAnswer?.answerCode === "REAL_DEAL_NEEDS_RECOVERY" && money(oReal) === money(before));

    // recurrence + overdue need their own fixtures (the mirror has no candidate / overdue)
    const rec = empty({ transactions: ["2026-06-05", "2026-07-05", "2026-08-05"].map((d) => tx({ type: "expense", status: "שולם", amount: 120, category: "מנויים", date: d })) });
    const r0 = derive(rec);
    const qRec = issueQ("FINANCE_EXPENSE_RECURRENCE", r0);
    ok("73. recurrence question exists on a repeated expense", !!qRec && !!qRec.identity);
    const rOne = derive(rec, [asAnswer(qRec, "ONE_TIME")]);
    ok("74. ONE_TIME closes the candidate and the main brief stops suggesting it", rOne.integrity.issues.find((i) => i.issueType === "RECURRING_EXPENSE_CANDIDATE")!.ownerResolved === true && !rOne.brief.items.some((i) => i.family === "RECURRING_EXPENSE_REVIEW") && money(rOne) === money(r0));
    const rRec = derive(rec, [asAnswer(qRec, "RECURRING")]);
    ok("75. RECURRING → Owner line, no recurring model / forecast created", rRec.brief.rehab.items.some((i) => i.epistemic === "OWNER_DECISION" && i.textHe.includes("לפי מה שאמרת זו הוצאה קבועה")) && JSON.stringify(rRec.state.expected) === JSON.stringify(r0.state.expected) && JSON.stringify(rRec.state.recurring) === JSON.stringify(r0.state.recurring));
    const p = project({ status: "בעבודה", name: "הופעה" });
    const od = empty({ projects: [p], financeSettings: [withPrice(p, 5000)], transactions: [tx({ projectId: p.id, scope: "project", amount: 2000, status: "צפוי", date: "2026-09-10", createdAt: "2026-09-01T00:00:00Z" })] });
    const o0 = derive(od);
    const qOd = issueQ("FINANCE_OVERDUE_REASON", o0);
    ok("76. overdue question exists on an overdue receivable", !!qOd?.identity);
    const oW = derive(od, [asAnswer(qOd, "WAITING_FOR_CLIENT")]);
    ok("77. overdue reason → Owner line; collection state and amounts unchanged", oW.brief.rehab.items.some((i) => i.textHe === "תשלום של ₪2,000 באיחור — לפי מה שאמרת: מחכה ללקוח.") && money(oW) === money(o0));
    const qCp = issueQ("FINANCE_COMPLETED_PROJECT_INCOME_STATUS");
    const cR = derive(RAW0, [asAnswer(qCp, "INCOME_RECEIVED_NOT_RECORDED")]);
    ok("78. INCOME_RECEIVED_NOT_RECORDED keeps the gap (still no recorded income) and never adds cash", cR.integrity.issues.find((i) => i.subjectId === qCp.subject.id)!.ownerResolved === false && cR.state.realized.ils.cashIn === before.state.realized.ils.cashIn && money(cR) === money(before));
    const uV = derive(RAW0, [asAnswer(qVictor, "UNKNOWN")]);
    check("79. UNKNOWN is a valid answer: not asked again, stays UNKNOWN", [uV.integrity.top.questions.some((q) => q.questionType === "FINANCE_RECURRING_PAYMENT_STATUS"), uV.brief.rehab.items[0].epistemic], [false, "UNKNOWN"]);
    // mismatching answers are never applied
    const wrongFp = { ...asAnswer(qVictor, "NOT_PAID"), factsFingerprint: "f".repeat(64) };
    const wrongSubject = { ...asAnswer(qVictor, "NOT_PAID"), subjectId: "VICTOR_SALARY:2026-07" };
    const wrongCode = { ...asAnswer(qVictor, "NOT_PAID"), answerCode: "THIS_WEEK" };
    ok("80. an answer with another fingerprint / subject / foreign code is never applied", [wrongFp, wrongSubject, wrongCode].every((a) => derive(RAW0, [a]).integrity.ownerAnswers.applied === 0));
    let every = true;
    // F2.11: the payment-date question is not an integrity question (tested in its own suite); a receivable-CLOSING
    // answer legitimately changes the collection view (receivables / pacing) — realized money must still be identical.
    const realizedOnly = (d: ReturnType<typeof derive>) => JSON.stringify({ realized: d.state.realized, openExpenses: d.state.openExpenses, summary: d.brief.summary });
    for (const t of FINANCE_QUESTION_TYPES.filter((x) => x !== "FINANCE_PAYMENT_DATE")) {
      const fixture = t === "FINANCE_EXPENSE_RECURRENCE" ? rec : t === "FINANCE_OVERDUE_REASON" ? od : RAW0;
      const d0 = derive(fixture);
      const q = issueQ(t, d0);
      for (const o of FINANCE_ANSWER_OPTIONS[t]) {
        const d1 = derive(fixture, [asAnswer(q, o.code, o.code === "EXACT_DATE" ? "2026-10-05" : null)]);
        if ((o.code === "PROJECT_CANCELLED_NO_FURTHER_PAYMENT" ? realizedOnly(d1) !== realizedOnly(d0) : money(d1) !== money(d0))) every = false;
      }
    }
    ok("81. EVERY answer of EVERY type leaves realized / open expenses (and, except a closing answer, receivables / expected / pacing) identical", every);
    check("82. resolving answers are exactly the Owner-approved closers", RESOLVING_ANSWERS, { FINANCE_COMPLETED_PROJECT_INCOME_STATUS: ["NON_PAID_PROJECT"], FINANCE_ORPHAN_SETTING_MEANING: ["HISTORICAL_ONLY"], FINANCE_EXPENSE_RECURRENCE: ["ONE_TIME"] });
    ok("83. answered lines never blame", !/שכחת|טעית|אשמ|הזנחת/.test(JSON.stringify([oReal.brief, rRec.brief, oW.brief, cR.brief, uV.brief])));
    ok("84. the state object is never mutated by consuming answers", (() => { const s = buildFinanceBrain(RAW0, NOW); const j = JSON.stringify(s); buildFinanceIntegrity(RAW0, s, NOW, [asAnswer(qVictor, "NOT_PAID"), asAnswer(qBal, "THIS_WEEK")]); return JSON.stringify(s) === j; })());
  }

  console.log("DTO v3 (85-92)");
  {
    const b = base.brief;
    check("85. v4 brief parses (strict)", [b.v, FINANCE_BRIEF_DTO_VERSION, parseFinanceBriefResponse(JSON.parse(JSON.stringify(b))).ok], [4, 4, true]);
    check("86. answerable question carries id + fingerprint + option codes; exact-date (with its rule) only on timing", b.rehab.questions.map((q) => [q.questionType, q.answer?.exactDateCode ?? null, q.answer?.exactDateRule ?? null, q.options.length]), [["FINANCE_RECURRING_PAYMENT_STATUS", null, null, 3], ["FINANCE_RECEIVABLE_TIMING", "EXACT_DATE", "NOT_BEFORE_TODAY", 7]]);
    const q0 = b.rehab.questions[0];
    const forged = (patch: Partial<FinanceRehabQuestionDto>) => parseFinanceBriefResponse({ ...b, rehab: { ...b.rehab, questions: [{ ...q0, ...patch }] } }).ok;
    ok("87. forged fingerprint / question id / type mismatch rejected", !forged({ answer: { ...q0.answer!, fingerprint: "abc" } }) && !forged({ answer: { ...q0.answer!, questionId: "x::FINANCE_RECURRING_PAYMENT_STATUS" } }) && !forged({ questionType: "FINANCE_RECEIVABLE_TIMING" }));
    ok("88. duplicate option codes / exactDateCode not among options rejected", !forged({ options: [q0.options[0], q0.options[0]] }) && !forged({ answer: { ...q0.answer!, exactDateCode: "EXACT_DATE" } }));
    ok("89. old v2 / v3 payloads rejected (fail closed)", !parseFinanceBriefResponse({ ...b, v: 2 }).ok && !parseFinanceBriefResponse({ ...b, v: 3 }).ok);
    ok("90. display-only question (answer null) is valid", forged({ answer: null }));
    ok("91. the same question twice rejected", !parseFinanceBriefResponse({ ...b, rehab: { ...b.rehab, questions: [q0, q0] } }).ok);
    ok("92. DTO carries no raw evidence / context ids", !/sourceId|contextId|evidence/.test(JSON.stringify(b)));
  }

  console.log("Route (93-108) — real POST route, answer binding faked");
  {
    const route = await import("../app/api/partner/finance/answer/route");
    const valid = { questionId: qVictor.identity!.questionId, answerCode: "UNKNOWN", seenQuestionFingerprint: qVictor.identity!.fingerprint, requestId: randomUUID() };
    routeFake.calls = 0;
    for (const [name, h] of [["cross-origin", { ...GOOD, origin: "https://evil.example" }], ["missing Origin", (({ origin, ...r }) => { void origin; return r; })(GOOD)], ["cross-site fetch", { ...GOOD, "sec-fetch-site": "cross-site" }], ["form content-type", { ...GOOD, "content-type": "application/x-www-form-urlencoded" }]] as const) {
      check(`93. ${name} → 403, service never called`, [(await post(route, valid, h as Record<string, string>)).status, routeFake.calls], [403, 0]);
    }
    check("94. unknown key → 400 before the service", [(await post(route, { ...valid, supersedesId: randomUUID() })).status, routeFake.calls], [400, 0]);
    check("95. oversized body → 400", [(await post(route, JSON.stringify({ ...valid, pad: "x".repeat(5000) }))).status, routeFake.calls], [400, 0]);
    check("96. invalid JSON → 400", (await post(route, "{not json")).status, 400);
    const map: Array<[Record<string, unknown>, number]> = [
      [{ status: "ANSWER_SAVED", contextId: "c", supersedesId: null }, 200], [{ status: "REPLAY", contextId: "c" }, 200], [{ status: "STALE_QUESTION" }, 200],
      [{ status: "REQUEST_ID_CONFLICT" }, 409], [{ status: "INVALID_INPUT", errors: ["x"] }, 400], [{ status: "UNAUTHORIZED" }, 401], [{ status: "FORBIDDEN" }, 403],
      [{ status: "LIVE_READ_FAILED", detail: "secret detail" }, 503], [{ status: "FAILED", detail: "secret detail" }, 500], [{ status: "INVARIANT_VIOLATION", detail: "secret detail" }, 500],
    ];
    for (const [result, code] of map) {
      routeFake.result = result;
      const r = await post(route, valid);
      check(`97. ${result.status} → HTTP ${code}, no internals, no-store`, [r.status, r.json.status, JSON.stringify(r.json).includes("secret"), r.cache], [code, result.status, false, "no-store"]);
    }
    check("98. valid body passed through unchanged", routeFake.input, valid);
    const src = strip(rd("app/api/partner/finance/answer/route.ts"));
    ok("99. POST only; guard first; strict whitelist", /export async function POST\(/.test(src) && !/export (async )?function (GET|PUT|PATCH|DELETE)/.test(src) && /const guard = checkSameOriginJson\(req\.headers\);\s*if \(guard\)/.test(src) && /ALLOWED_KEYS = \["questionId", "answerCode", "seenQuestionFingerprint", "requestId", "exactDateYmd"\]/.test(src));
    check("100. no non-owner role may reach the answer route (proxy allowlists)", [isVictorAllowedPath, isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].map((f) => f("/api/partner/finance/answer")), [false, false, false, false, false]);

    // the REAL answer binding (requireOwner + session actor), store binding + live loader faked
    const service = await import("../lib/partner/finance/answer-service");
    const h = harness();
    svc.h = h;
    const liveOf = async () => { const answers = await h.activeAnswers(); const d = derive(RAW0, answers); return { status: "OK", state: d.state, integrity: d.integrity, answers, answersAvailable: true, answersDetail: null }; };
    svc.live = await liveOf();
    auth.role = "none";
    check("101. no session → UNAUTHORIZED, nothing written", [(await service.answerFinanceQuestion(valid)).status, h.db.rows.length], ["UNAUTHORIZED", 0]);
    auth.role = "victor";
    check("102. non-owner → FORBIDDEN, nothing written", [(await service.answerFinanceQuestion(valid)).status, h.db.rows.length], ["FORBIDDEN", 0]);
    auth.role = "owner"; auth.userId = null;
    check("103. owner check passed but no user → UNAUTHORIZED", (await service.answerFinanceQuestion(valid)).status, "UNAUTHORIZED");
    auth.userId = ACTOR;
    svc.live = { ...(await liveOf()), answersAvailable: false, answersDetail: "x" };
    check("104. unreadable Owner answers → LIVE_READ_FAILED (never answers blindly)", [(await service.answerFinanceQuestion({ ...valid, requestId: randomUUID() })).status, h.db.rows.length], ["LIVE_READ_FAILED", 0]);
    svc.live = await liveOf();
    check("105. owner → one append through the real binding", [(await service.answerFinanceQuestion({ ...valid, requestId: randomUUID() })).status, svc.appendCalls, h.db.rows.length], ["ANSWER_SAVED", 1, 1]);
    svc.live = await liveOf();
    check("106. the answered question is gone for the next request (STALE_QUESTION, no second row)", [(await service.answerFinanceQuestion({ ...valid, requestId: randomUUID(), answerCode: "NOT_PAID" })).status, h.db.rows.length], ["STALE_QUESTION", 1]);
    const svcSrc = strip(rd("lib/partner/finance/answer-service.ts"));
    ok("107. binding: server-only, requireOwner then getAuthUser before the core", /^import "server-only";/m.test(rd("lib/partner/finance/answer-service.ts")) && /requireOwner\(\)[\s\S]*getAuthUser\(\)[\s\S]*answerFinanceQuestionCore\(deps, user\.id, input\)/.test(svcSrc));
    ok("108. the finance GET route stays GET-only and imports only the read binding", !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(rd("app/api/partner/finance/route.ts")) && /@\/lib\/partner\/finance\/server/.test(rd("app/api/partner/finance/route.ts")));
  }

  console.log("UI (109-122)");
  {
    const b = base.brief;
    const noop = () => {};
    const controls = (patch: Partial<FinanceAnswerControls> = {}): FinanceAnswerControls => ({
      busy: false, activeQuestionId: null, message: null, exactFor: null, exactYmd: "", todayYmd: "2026-09-24",
      onAnswer: noop, onOpenExact: noop, onExactYmd: noop, onConfirmExact: noop, onCancelExact: noop,
      renderDatePicker: ({ ariaLabel }) => <input data-date-picker aria-label={ariaLabel} />, ...patch,
    });
    const d = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={b} financeControls={controls()} />);
    check("109. real answer buttons for both questions (3 + 7)", (d.match(/data-finance-answer="/g) ?? []).length, 10);
    ok("110. buttons are type=button and labelled in Hebrew", /<button type="button" data-finance-answer="PAID_NEEDS_RECORDING"[^>]*>שולם — צריך לרשום בכספים<\/button>/.test(d));
    ok("111. questions marked answerable; no read-only notice", (d.match(/data-answerable="true"/g) ?? []).length === 2 && !d.includes("לעיון בלבד"));
    const busy = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={b} financeControls={controls({ busy: true, activeQuestionId: b.rehab.questions[0].answer!.questionId })} />);
    check("112. while saving EVERY answer button is disabled + 'שומר…'", [(busy.match(/data-finance-answer="[A-Z_]+" disabled=""/g) ?? []).length, busy.includes("שומר…")], [10, true]);
    const exact = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={b} financeControls={controls({ exactFor: b.rehab.questions[1].answer!.questionId })} />);
    ok("113. EXACT_DATE opens a date picker; confirm disabled until a date is picked", exact.includes("data-date-picker") && /data-finance-exact-confirm="true" disabled=""/.test(exact) && exact.includes("שום רישום בכספים לא משתנה"));
    const msg = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={b} financeControls={controls({ activeQuestionId: b.rehab.questions[0].answer!.questionId, message: "לא הצלחתי לשמור" })} />);
    ok("114. an error message shows on its own question", /data-finance-answer-message="true"[^>]*>לא הצלחתי לשמור/.test(msg));
    const noticeHtml = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={b} financeControls={controls()} financeNotice={FINANCE_STALE_MESSAGE_HE} />);
    ok("115. stale notice 'השאלה השתנתה. רעננתי את המידע.' inside צריך ממך", noticeHtml.includes(`data-finance-notice="true" style="margin:0 0 6px;font-size:12px;color:#A0A0A0">השאלה השתנתה. רעננתי את המידע.`));
    const ro = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={b} />);
    ok("116. without controls the options stay plain text (no buttons)", !/<button/.test(ro) && ro.includes("לעיון בלבד"));
    const prevBrief: FinanceBriefDto = { ...b, rehab: { ...b.rehab, questions: [{ ...b.rehab.questions[1], answer: { ...b.rehab.questions[1].answer!, previousAnswerHe: "ענית בעבר: בחודש הבא. הנתונים השתנו מאז." } }] } };
    ok("117. a changed question shows the earlier answer", renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} finance={prevBrief} financeControls={controls()} />).includes("ענית בעבר: בחודש הבא. הנתונים השתנו מאז."));
    const m = renderToStaticMarkup(<div style={{ width: 360 }}><PartnerActionsView items={[]} isMobile finance={b} financeControls={controls()} /></div>);
    ok("118. mobile: buttons wrap (flex-wrap) and keep a 30px min touch height", /role="group" aria-label="תשובה" style="display:flex;flex-wrap:wrap/.test(m) && /min-height:30px/.test(m));
    // client helpers
    const qd = b.rehab.questions[1];
    const att = buildFinanceAnswerAttempt(qd, "THIS_WEEK", null, "0f0f0f0f-0000-4000-8000-000000000001");
    check("119. attempt echoes the question exactly as rendered", att, { url: FINANCE_ANSWER_URL, body: { questionId: qd.answer!.questionId, answerCode: "THIS_WEEK", seenQuestionFingerprint: qd.answer!.fingerprint, requestId: "0f0f0f0f-0000-4000-8000-000000000001", exactDateYmd: null } });
    check("120. attempt refuses: unknown code / EXACT without date / date on window / no requestId / display-only", [buildFinanceAnswerAttempt(qd, "NOPE", null, "r"), buildFinanceAnswerAttempt(qd, "EXACT_DATE", null, "r"), buildFinanceAnswerAttempt(qd, "THIS_WEEK", "2026-10-01", "r"), buildFinanceAnswerAttempt(qd, "THIS_WEEK", null, ""), buildFinanceAnswerAttempt({ ...qd, answer: null }, "THIS_WEEK", null, "r")], [null, null, null, null, null]);
    check("121. response interpretation (fail closed)", [interpretFinanceAnswerResponse(200, { status: "ANSWER_SAVED" }).ui, interpretFinanceAnswerResponse(200, { status: "REPLAY" }).ui, interpretFinanceAnswerResponse(200, { status: "STALE_QUESTION" }), interpretFinanceAnswerResponse(409, { status: "REQUEST_ID_CONFLICT" }).ui, interpretFinanceAnswerResponse(500, null).ui, interpretFinanceAnswerResponse(200, { status: "WHAT" }).ui, interpretFinanceAnswerResponse(200, "x").ui], ["saved", "saved", { ui: "stale", messageHe: "השאלה השתנתה. רעננתי את המידע." }, "error", "error", "error", "error"]);
    const sec = strip(rd("components/partner/PartnerActionsSection.tsx"));
    ok("122. section: double-click ref guard, fresh requestId per click, disable while saving, ALWAYS re-fetch", /if \(submitting\.current \|\| !q\.answer\) return;/.test(sec) && /buildFinanceAnswerAttempt\(q, answerCode, exactDateYmd, newRequestId\(\)\)/.test(sec) && /const anyBusy = ui\.phase === "submitting" \|\| fin\.busy;/.test(sec) && /\(ui\.phase === "submitting" && !mine\) \|\| fin\.busy/.test(sec) && /setFinanceNotice\(outcome\.messageHe\); \}\s*await load\(\);/.test(sec));
  }

  console.log("Boundaries (123-132)");
  {
    const FILES = ["lib/partner/finance/answer.ts", "lib/partner/finance/answer-service.ts", "lib/partner/finance/owner-answers.ts", "lib/partner/finance/integrity.ts", "lib/partner/finance/brief.ts", "lib/partner/finance/server.ts", "lib/partner/finance/dto.ts", "app/api/partner/finance/answer/route.ts", "components/partner/PartnerFinanceBrief.tsx", "components/partner/partner-finance-answer-client.ts", "lib/partner/investigation/finance-questions.ts"];
    const src = FILES.map((f) => strip(rd(f)));
    ok("123. no transaction / setting / project / price / due-date write (no insert / update / upsert / delete)", src.every((s) => !/\.insert\(|\.update\(|\.upsert\(|(?<!\bm|ledger)\.delete\(|from\("(transactions|finance_settings|projects)"\)/.test(s)));
    ok("124. no Action Event, no decision, no execution", src.every((s) => !/partner_action_events|appendDecision|decideSuggestedAction|executeApprovedAction|event-store|\.rpc\(/.test(s)));
    ok("125. no Push / Cron / Agent Alerts / Feedback / baseline", src.every((s) => !/web-push|lib\/push|node-cron|agent_alerts|alerts-store|partner_feedback|feedback\/store|savePartnerBaseline/.test(s)));
    check("126. appendOwnerContext is bound in exactly one finance file (answer-service)", FILES.filter((f, i) => /import \{ appendOwnerContext \} from/.test(src[i])), ["lib/partner/finance/answer-service.ts"]);
    ok("127. integrity / brief / owner-answers are pure (no store, no Supabase, no clock)", ["lib/partner/finance/integrity.ts", "lib/partner/finance/brief.ts", "lib/partner/finance/owner-answers.ts"].every((f) => !/context-store|lib\/supabase|new Date\(\)|Date\.now\(/.test(strip(rd(f)))));
    ok("128. the answer core never binds a store and never reads the clock", !/context-store|lib\/supabase|server-only|new Date\(\)|Date\.now\(/.test(strip(rd("lib/partner/finance/answer.ts"))));
    ok("129. provenance parser: strict owner_manual, or the strict P1 owner_via_claude shape only (unknown sources / keys refused)", /raw\.source === "owner_manual"/.test(rd("lib/partner/investigation/context-row.ts")) && /raw\.source === "owner_via_claude"/.test(rd("lib/partner/investigation/context-row.ts")) && /provenance\.source: unsupported value/.test(rd("lib/partner/investigation/context-row.ts")) && /provenance: unknown key/.test(rd("lib/partner/investigation/context-row.ts")));
    ok("130. no DB migration / DDL in this change", !fs.readdirSync(ROOT).some((f) => /f2\.?8.*\.sql$/i.test(f)) && src.every((s) => !/create table|alter table|create index/i.test(s)));
    ok("131. the UI never imports server code (HTTP only)", ["components/partner/PartnerFinanceBrief.tsx", "components/partner/partner-finance-answer-client.ts", "components/partner/PartnerActionsSection.tsx"].every((f) => !/from "[^"]*(answer-service|finance\/server|context-store|lib\/supabase|finance\/answer)"/.test(rd(f))));
    const self = fs.readFileSync(__filename, "utf8");
    ok("132. this test never imports a production binding statically", !/^import .* from ["'][^"']*(lib\/supabase|finance\/server|context-store|require-auth|answer-service)["'];$/m.test(self));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
