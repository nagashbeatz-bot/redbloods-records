/**
 * Tests — Redbloods Partner Organizational Memory V1 (F2.19–F2.23).
 *
 * Run with:   npx tsx scripts/test-partner-memory.tsx
 *
 * NEVER touches production: the pure memory builder + question pre-flight on the shared production mirror and
 * synthetic Owner Context / Action Event / Outcome records; static read-only safety guards; the knowledge
 * contract enforcement (every Owner-question type must declare how its knowledge is learned and reused).
 */
import fs from "node:fs";
import path from "node:path";
import { buildPartnerMemory, derivePatternCandidates, entityForSubject, recallEntity, PATTERN_MIN_INSTANCES, VICTOR_VENDOR, type MemorySources } from "../lib/partner/memory/core";
import { resolveKnownAnswerBeforeAsking } from "../lib/partner/memory/preflight";
import { PARTNER_KNOWLEDGE_CONTRACT } from "../lib/partner/memory/contract";
import { ANSWER_OPTIONS } from "../lib/partner/investigation/questions";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import type { FinanceOwnerAnswer } from "../lib/partner/finance/owner-answers";
import type { OwnerQuestion } from "../lib/partner/finance/integrity";
import type { FinanceRaw } from "../lib/partner/finance/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import type { PartnerActionEvent } from "../lib/partner/actions/events";
import type { PartnerActionOutcome } from "../lib/partner/actions/outcome";
import { productionMirror, tx } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const NOW = new Date("2026-09-24T09:00:00Z");
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The mirror plus Victor May–July: all marked paid on the salary page, none in Finance; the legacy store says May/June expected. */
function victorRaw(opts: { mayJunLegacy?: boolean; periods?: string[] } = {}): FinanceRaw {
  const raw = productionMirror();
  const periods = opts.periods ?? ["2026-05", "2026-06", "2026-07"];
  raw.victorSalary = [...periods.map((p) => ({ workMonth: p, dueDate: `${p.slice(0, 5)}${String(Number(p.slice(5)) + 1).padStart(2, "0")}-10`, amount: 550, currency: "$", status: "שולם", transactionId: null })), ...(raw.victorSalary ?? [])];
  raw.victorLegacyPayments = opts.mayJunLegacy === false ? [] : [{ month: "2026-05", status: "צפוי", paidDate: null }, { month: "2026-06", status: "צפוי", paidDate: null }];
  return raw;
}
const ctx = (o: Partial<PersistedOwnerContext> & { id: string; questionType: string; subjectType: string; subjectId: string; answerCode: string }): PersistedOwnerContext => ({
  schemaVersion: "partner-owner-context-schema-v2", questionId: `finance:X:${o.subjectType}:${o.subjectId}::${o.questionType}`, caseId: `finance:X:${o.subjectType}:${o.subjectId}`, caseType: "X",
  answerValue: null, triggerContextId: null, questionTextHe: "q", caseFactsFingerprint: "f".repeat(64), note: null, answeredAt: "2026-09-24T08:00:00.000Z", scope: "CASE_INSTANCE", provenance: { source: "owner_manual" },
  caseSchemaVersion: "v", supersedesId: null, ...o,
} as PersistedOwnerContext);
const PROJECT = "10d23186-a5ab-4eed-a9a4-eeda221a34d5", OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";
const event = (id: number, type: string, at: string, subjectId = PROJECT): PartnerActionEvent => ({
  id: uuid(id), createdAt: at, requestId: uuid(100 + id), actionId: `UPDATE_PROJECT_DEADLINE:${subjectId}:x:2026-10-07`, actionType: "UPDATE_PROJECT_DEADLINE", subjectType: "project", subjectId,
  eventType: type as PartnerActionEvent["eventType"], supersedesEventId: null, actorKind: "OWNER", actorUserId: uuid(999),
  snapshot: { sourceContextIds: [uuid(1), uuid(2)] } as unknown as PartnerActionEvent["snapshot"], snapshotHash: "a".repeat(64), revalidation: {}, execution: null, deferChoice: null, deferUntil: null, note: null,
});
const outcome = (state: string, subjectId = PROJECT): PartnerActionOutcome => ({
  schemaVersion: "partner-action-outcome-v1", state: state as PartnerActionOutcome["state"], actionId: `UPDATE_PROJECT_DEADLINE:${subjectId}:x:2026-10-07`, actionType: "UPDATE_PROJECT_DEADLINE", subject: { type: "project", id: subjectId },
  subjectLabel: "קרוב אלייך", approvalEventId: uuid(1), executedEventId: uuid(2), snapshotHash: "a".repeat(64), executed: { field: "deadline", from: "2026-07-14", to: "2026-10-07", executedAt: "2026-09-23T17:05:19Z", approvedAt: "2026-09-23T16:00:00Z" },
  expectedValue: "2026-10-07", current: { value: "2026-10-07", updatedAt: "2026-09-23T17:05:19Z" }, evaluatedAt: NOW.toISOString(), evidence: [], reasons: [], summaryHe: "הדדליין עודכן",
});
const answersFrom = (v: ReturnType<typeof deriveFinanceView>, type: string, code: string, ymd: string | null, id: string): FinanceOwnerAnswer => {
  const q = v.integrity.questions.find((x) => x.questionType === type) ?? v.integrity.top.questions.find((x) => x.questionType === type)!;
  return { contextId: id, questionId: q.identity!.questionId, questionType: type as FinanceOwnerAnswer["questionType"], caseId: q.identity!.caseId, caseType: q.identity!.issueType, subjectType: q.subject.type, subjectId: q.subject.id, answerCode: code, answerValueYmd: ymd, factsFingerprint: q.identity!.fingerprint, answeredAt: NOW.toISOString() };
};
function sources(raw: FinanceRaw, extra: Partial<MemorySources> = {}, answers: FinanceOwnerAnswer[] = []): MemorySources {
  return {
    now: NOW,
    finance: { status: "OK", raw, view: deriveFinanceView(raw, NOW, answers) },
    ownerContexts: { status: "OK", history: [] },
    actionEvents: { status: "OK", events: [] },
    outcomes: { status: "OK", outcomes: [] },
    ...extra,
  };
}
const ent = (m: ReturnType<typeof buildPartnerMemory>, key: string) => m.entities.find((e) => e.entity.key === key);

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  // production-like Victor August: Owner said paid + gave the date
  const raw0 = victorRaw();
  const v0 = deriveFinanceView(raw0, NOW);
  const aStatus = answersFrom(v0, "FINANCE_RECURRING_PAYMENT_STATUS", "PAID_NEEDS_RECORDING", null, uuid(11));
  const aDate = answersFrom(deriveFinanceView(raw0, NOW, [aStatus]), "FINANCE_PAYMENT_DATE", "EXACT_DATE", "2026-09-10", uuid(12));
  const ctxStatus = ctx({ id: uuid(11), questionId: aStatus.questionId, caseId: aStatus.caseId, questionType: "FINANCE_RECURRING_PAYMENT_STATUS", subjectType: "recurring", subjectId: "VICTOR_SALARY:2026-08", answerCode: "PAID_NEEDS_RECORDING", caseFactsFingerprint: aStatus.factsFingerprint });
  const ctxDate = ctx({ id: uuid(12), questionId: aDate.questionId, caseId: aDate.caseId, questionType: "FINANCE_PAYMENT_DATE", subjectType: "recurring", subjectId: "VICTOR_SALARY:2026-08", answerCode: "EXACT_DATE", caseFactsFingerprint: aDate.factsFingerprint, answerValue: { kind: "DATE", ymd: "2026-09-10", resolution: { method: "EXPLICIT", anchorYmd: "2026-09-24", timeZone: "Asia/Jerusalem" } } as PersistedOwnerContext["answerValue"] });
  const answers = [aStatus, aDate];
  const memArgs = () => sources(raw0, { ownerContexts: { status: "OK", history: [ctxStatus, ctxDate] } }, answers);
  const mem = buildPartnerMemory(memArgs());
  const aug = ent(mem, "recurring:VICTOR_SALARY:2026-08")!;

  console.log("Identity + precedence (36-40)");
  {
    const withTx = clone(raw0); withTx.transactions.push(tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08", scope: "general", date: "2026-09-10" }));
    const memLive = buildPartnerMemory(sources(withTx, { ownerContexts: { status: "OK", history: [ctxStatus, ctxDate] } }, answers));
    const augLive = ent(memLive, "recurring:VICTOR_SALARY:2026-08")!;
    ok("36. current live state wins: once Finance has the record, 'missing' is no longer current", (augLive.facts.find((f) => f.code === "FINANCE_RECORD")!.value as { present: boolean }).present === true && augLive.observations.every((o) => !o.current));
    const older = ctx({ id: uuid(21), questionType: "FINANCE_RECEIVABLE_TIMING", subjectType: "receivable", subjectId: `PROJECT_BALANCE:${PROJECT}`, answerCode: "NEXT_MONTH", answeredAt: "2026-09-20T08:00:00.000Z" });
    const newer = ctx({ id: uuid(22), questionType: "FINANCE_RECEIVABLE_TIMING", subjectType: "receivable", subjectId: `PROJECT_BALANCE:${PROJECT}`, answerCode: "THIS_WEEK", supersedesId: uuid(21), answeredAt: "2026-09-21T08:00:00.000Z" });
    const memRev = buildPartnerMemory(sources(raw0, { ownerContexts: { status: "OK", history: [older, newer] } }));
    check("37. active Owner Context wins over the older revision (history kept)", ent(memRev, `receivable:PROJECT_BALANCE:${PROJECT}`)!.ownerDecisions.map((d) => [d.answerCode, d.status]), [["NEXT_MONTH", "SUPERSEDED"], ["THIS_WEEK", "ACTIVE"]]);
    check("38. exact entity identity", [aug.entity.key, aug.entity.kind, aug.entity.parents], ["recurring:VICTOR_SALARY:2026-08", "recurring_period", ["recurring:VICTOR_SALARY", "vendor:VICTOR"]]);
    ok("39. period identity preserved (2026-07 ≠ 2026-08)", !!ent(mem, "recurring:VICTOR_SALARY:2026-07") && ent(mem, "recurring:VICTOR_SALARY:2026-07")!.ownerDecisions.length === 0 && aug.ownerDecisions.length === 2);
    const sept = clone(raw0); sept.victorSalary = [...sept.victorSalary!.filter((s) => s.workMonth !== "2026-09"), { workMonth: "2026-09", dueDate: "2026-09-20", amount: 550, currency: "$", status: "שולם", transactionId: null }];
    const vSept = deriveFinanceView(sept, NOW, answers);
    const septQ = vSept.integrity.questions.find((q) => q.subject.id === "VICTOR_SALARY:2026-09");
    ok("40. the August answer is never applied to September", !septQ || resolveKnownAnswerBeforeAsking(septQ, { raw: sept, answers }).status === "NOT_KNOWN");
  }

  console.log("Question pre-flight (41-43, 60-61)");
  {
    const q = v0.integrity.top.questions.find((x) => x.questionType === "FINANCE_RECURRING_PAYMENT_STATUS")!;
    check("41. answered question suppressed (KNOWN_OWNER_DECISION)", [resolveKnownAnswerBeforeAsking(q, { raw: raw0, answers }).status, resolveKnownAnswerBeforeAsking(q, { raw: raw0, answers }).suppress], ["KNOWN_OWNER_DECISION", true]);
    const staleAnswer = { ...aStatus, factsFingerprint: "0".repeat(64) };
    const vStale = deriveFinanceView(raw0, NOW, [staleAnswer]);
    const qStale = vStale.integrity.top.questions.find((x) => x.questionType === "FINANCE_RECURRING_PAYMENT_STATUS")!;
    check("42. stale prior answer re-opens the question (not suppressed)", [resolveKnownAnswerBeforeAsking(qStale, { raw: raw0, answers: [staleAnswer] }).status, vStale.integrity.top.questions.some((x) => x.questionType === "FINANCE_RECURRING_PAYMENT_STATUS")], ["KNOWN_HISTORICAL_BUT_STALE", true]);
    const briefStale = buildFinanceBrief(vStale.state, vStale.integrity, { actionNoteHe: vStale.actionNoteHe });
    ok("43. previous answer displayed when re-opened", briefStale.rehab.questions.find((x) => x.questionType === "FINANCE_RECURRING_PAYMENT_STATUS")?.answer?.previousAnswerHe === "ענית בעבר: שולם — צריך לרשום בכספים. הנתונים השתנו מאז.");
    const withTx = clone(raw0); withTx.transactions.push(tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08", scope: "general", date: "2026-09-10" }));
    check("60. pre-flight checks LIVE state first (a Finance record answers the question itself)", resolveKnownAnswerBeforeAsking(q, { raw: withTx, answers: [] }).status, "KNOWN_CURRENT");
    ok("60b. the finance view runs the pre-flight on every surfaced question (structural HARD RULE)", /resolveKnownAnswerBeforeAsking\(q, \{ raw, answers \}\)/.test(rd("lib/partner/finance/view.ts")) && /\.suppress/.test(rd("lib/partner/finance/view.ts")));
    const vAns = deriveFinanceView(raw0, NOW, answers);
    ok("61. known answers prevent duplicate Owner questions (Victor August asks nothing; both recorded as prevented)", !vAns.integrity.top.questions.some((x) => x.subject.id === "VICTOR_SALARY:2026-08") && ["FINANCE_RECURRING_PAYMENT_STATUS", "FINANCE_PAYMENT_DATE"].every((t) => vAns.preflight.some((p) => p.questionType === t && p.verdict.status === "KNOWN_OWNER_DECISION" && p.verdict.suppress)));
    const conflictQ = deriveFinanceView(victorRaw(), NOW).integrity.questions.find((x) => x.subject.id === "VICTOR_SALARY:2026-05");
    ok("pre-flight: conflicting evidence is explicit (asking stays allowed)", !conflictQ || resolveKnownAnswerBeforeAsking(conflictQ, { raw: victorRaw(), answers: [] }).status !== "KNOWN_OWNER_DECISION");
  }

  console.log("History: decisions, actions, outcomes (44-46)");
  {
    const cA = ctx({ id: uuid(1), questionType: "WHY_DEADLINE_STILL_ACTIVE", subjectType: "project", subjectId: PROJECT, answerCode: "DEADLINE_NOT_UPDATED" });
    const cB = ctx({ id: uuid(2), questionType: "WHAT_IS_NEW_PROJECT_DEADLINE", subjectType: "project", subjectId: PROJECT, answerCode: "IN_TWO_WEEKS", triggerContextId: uuid(1), answerValue: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } } as PersistedOwnerContext["answerValue"] });
    const m = buildPartnerMemory(sources(raw0, {
      ownerContexts: { status: "OK", history: [cA, cB] },
      actionEvents: { status: "OK", events: [event(1, "APPROVED", "2026-09-23T16:00:00Z"), event(2, "EXECUTED", "2026-09-23T17:05:19Z")] },
      outcomes: { status: "OK", outcomes: [outcome("APPLIED_AS_EXPECTED")] },
    }));
    const p = ent(m, `project:${PROJECT}`)!;
    check("44. entity history includes Owner Context (both answers, with the resolved value)", p.ownerDecisions.map((d) => [d.questionType, d.answerCode, d.answerValueYmd]), [["WHY_DEADLINE_STILL_ACTIVE", "DEADLINE_NOT_UPDATED", null], ["WHAT_IS_NEW_PROJECT_DEADLINE", "IN_TWO_WEEKS", "2026-10-07"]]);
    check("45. entity history includes the Action chain + the Owner Context it relied on", p.actions.map((a) => [a.actionType, a.events.map((e) => e.eventType), a.headEventType, a.ownerContextIds]), [["UPDATE_PROJECT_DEADLINE", ["APPROVED", "EXECUTED"], "EXECUTED", [uuid(1), uuid(2)]]]);
    check("46. entity history includes the Outcome + resolution + live deadline fact", [p.outcomes.map((o) => o.state), p.resolutions.map((r) => r.code), p.facts.find((f) => f.code === "PROJECT_DEADLINE")?.value], [["APPLIED_AS_EXPECTED"], ["RESOLVED_BY_ACTION"], "2026-10-07"]);
    ok("58. project history is never attached to another project", !ent(m, `project:${OTHER_PROJECT}`) && m.entities.filter((e) => e.actions.length).every((e) => e.entity.key === `project:${PROJECT}`));
  }

  console.log("Observations, patterns, conflicts (47-52)");
  {
    const one = buildPartnerMemory(sources(victorRaw({ periods: [], mayJunLegacy: false })));
    check("47. one occurrence = observation only (no pattern)", [one.entities.filter((e) => e.observations.length).map((e) => e.entity.key), one.patternCandidates.length], [["recurring:VICTOR_SALARY:2026-08"], 0]);
    const two = buildPartnerMemory(sources(victorRaw({ periods: ["2026-07"], mayJunLegacy: false })));
    check("48. two similar clean periods = PATTERN_CANDIDATE", two.patternCandidates.map((c) => [c.signature.issueType, c.instances, c.evidenceQuality]), [["PAID_BUT_MISSING_FINANCE_RECORD", ["recurring:VICTOR_SALARY:2026-07", "recurring:VICTOR_SALARY:2026-08"], "CONSISTENT"]]);
    check("49. the candidate stays hypothesis-level", [two.patternCandidates[0].epistemic, two.patternCandidates[0].status], ["PATTERN_CANDIDATE", "CANDIDATE"]);
    const many = buildPartnerMemory(sources(victorRaw({ periods: ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"], mayJunLegacy: false })));
    check("50. repetition alone never confirms a pattern", [many.patternCandidates[0].instances.length >= 5, many.confirmedPatterns.length], [true, 0]);
    const may = ent(mem, "recurring:VICTOR_SALARY:2026-05")!;
    check("51. conflicting sources → MemoryConflict (sources, values, precedence, winner)", may.conflicts.map((c) => [c.code, c.values.map((v) => [v.source, v.value, v.precedence]), c.winning]), [["PAYMENT_STATUS_SOURCES_DISAGREE", [["VICTOR_SALARY_STATUS", "PAID", 2], ["VICTOR_LEGACY_PAYMENT_STORE", "NOT_PAID", 3]], { source: "VICTOR_SALARY_STATUS", value: "PAID" }]]);
    const contestedOnly = buildPartnerMemory(sources(victorRaw({ periods: ["2026-05", "2026-06"] })));
    check("52. conflicts never count as evidence (2 contested + 1 clean → no candidate)", [contestedOnly.patternCandidates.length, contestedOnly.entities.filter((e) => e.observations.some((o) => o.contested)).length], [0, 2]);
    check("production-shaped Victor: MIXED candidate (Jul+Aug clean, May+Jun contested)", mem.patternCandidates.map((c) => [c.instances, c.contestedInstances, c.evidenceQuality]), [[["recurring:VICTOR_SALARY:2026-07", "recurring:VICTOR_SALARY:2026-08"], ["recurring:VICTOR_SALARY:2026-05", "recurring:VICTOR_SALARY:2026-06"], "MIXED"]]);
    ok("owner-facing pattern wording is honest about mixed evidence", mem.patternCandidates[0].noteHe.includes("הנתונים ההיסטוריים לא מספיק אחידים"));
    check("pattern threshold (V1)", PATTERN_MIN_INSTANCES, 2);
  }

  console.log("Resolution, determinism, isolation, fail-closed (53-64)");
  {
    const withTx = clone(raw0); withTx.transactions.push(tx({ type: "expense", status: "שולם", amount: 550, currency: "$", linkedSessionId: "victor_salary_2026-08", scope: "general", date: "2026-09-10" }));
    const memLive = buildPartnerMemory(sources(withTx, { ownerContexts: { status: "OK", history: [ctxStatus, ctxDate] } }, answers));
    const augLive = ent(memLive, "recurring:VICTOR_SALARY:2026-08")!;
    check("53. resolved live state closes the historical 'missing' issue", augLive.resolutions.map((r) => [r.code, r.resolvedIssue]), [["RESOLVED_SINCE_OBSERVATION", "PAID_BUT_MISSING_FINANCE_RECORD"]]);
    ok("54. history remains available after resolution (answers + non-current observation)", augLive.ownerDecisions.length === 2 && augLive.observations.length === 1 && augLive.observations[0].current === false);
    check("55. reload → identical memory", JSON.stringify(buildPartnerMemory(memArgs())), JSON.stringify(mem));
    const reserialized = buildPartnerMemory(sources(clone(raw0), { ownerContexts: { status: "OK", history: clone([ctxStatus, ctxDate]) } }, clone(answers)));
    check("56. rebuilt from serialized sources (fresh-process equivalent) → identical memory", JSON.stringify(reserialized), JSON.stringify(mem));
    const cOther = ctx({ id: uuid(31), questionType: "WHY_DEADLINE_STILL_ACTIVE", subjectType: "project", subjectId: OTHER_PROJECT, answerCode: "CLIENT_DELAY" });
    const m2 = buildPartnerMemory(sources(raw0, { ownerContexts: { status: "OK", history: [ctxStatus, cOther] } }));
    ok("57. no cross-entity leakage", ent(m2, `project:${OTHER_PROJECT}`)!.ownerDecisions.every((d) => d.contextId === uuid(31)) && ent(m2, "recurring:VICTOR_SALARY:2026-08")!.ownerDecisions.every((d) => d.contextId === uuid(11)));
    ok("59. Victor history stays vendor-specific", recallEntity(mem, VICTOR_VENDOR).every((e) => e.entity.key === VICTOR_VENDOR || e.entity.key.startsWith("recurring:VICTOR_SALARY")) && recallEntity(mem, VICTOR_VENDOR).length >= 4);
    const src = memArgs();
    const moneyBefore = JSON.stringify({ realized: src.finance.status === "OK" ? src.finance.view.state.realized : null, receivables: src.finance.status === "OK" ? src.finance.view.state.receivables : null });
    buildPartnerMemory(src);
    const moneyAfter = JSON.stringify({ realized: src.finance.status === "OK" ? src.finance.view.state.realized : null, receivables: src.finance.status === "OK" ? src.finance.view.state.receivables : null });
    ok("63. memory never changes realized money (inputs untouched)", moneyBefore === moneyAfter);
    const failClosed = buildPartnerMemory({ now: NOW, finance: { status: "UNAVAILABLE", detail: "x" }, ownerContexts: { status: "UNAVAILABLE", detail: "x" }, actionEvents: { status: "UNAVAILABLE", detail: "x" }, outcomes: { status: "UNAVAILABLE", detail: "x" } });
    check("64. unavailable / unreadable sources fail closed (reported, never read as 'nothing happened')", [failClosed.sources, failClosed.entities.length, failClosed.patternCandidates.length], [{ ownerContext: "UNAVAILABLE", actionEvents: "UNAVAILABLE", outcomes: "UNAVAILABLE", finance: "UNAVAILABLE" }, 0, 0]);
    check("entity mapping: receivable belongs to its project; unknown subject never becomes a project", [entityForSubject("receivable", `PROJECT_BALANCE:${PROJECT}`).parents, entityForSubject("weird", "x").kind], [[`project:${PROJECT}`], "transaction"]);
    check("derivePatternCandidates is pure on its input", JSON.stringify(derivePatternCandidates(mem.entities)), JSON.stringify(mem.patternCandidates));
    ok("מראות-shaped closure is remembered as an Owner decision + CLOSED_BY_OWNER_DECISION", (() => {
      const q = v0.integrity.top.questions.find((x) => x.questionType === "FINANCE_RECEIVABLE_TIMING")!;
      const c = ctx({ id: uuid(41), questionId: q.identity!.questionId, caseId: q.identity!.caseId, questionType: "FINANCE_RECEIVABLE_TIMING", subjectType: "receivable", subjectId: q.subject.id, answerCode: "PROJECT_CANCELLED_NO_FURTHER_PAYMENT", caseFactsFingerprint: q.identity!.fingerprint });
      const a = { contextId: uuid(41), questionId: q.identity!.questionId, questionType: "FINANCE_RECEIVABLE_TIMING" as const, caseId: q.identity!.caseId, caseType: q.identity!.issueType, subjectType: q.subject.type, subjectId: q.subject.id, answerCode: "PROJECT_CANCELLED_NO_FURTHER_PAYMENT", answerValueYmd: null, factsFingerprint: q.identity!.fingerprint, answeredAt: NOW.toISOString() };
      const m = buildPartnerMemory(sources(raw0, { ownerContexts: { status: "OK", history: [c] } }, [a]));
      const e = ent(m, `receivable:${q.subject.id}`)!;
      return e.resolutions.some((r) => r.code === "CLOSED_BY_OWNER_DECISION") && (e.facts.find((f) => f.code === "RECEIVABLE_COLLECTION")!.value as { state: string }).state === "NOT_COLLECTIBLE" && !deriveFinanceView(raw0, NOW, [a]).integrity.top.questions.some((x) => x.questionType === "FINANCE_RECEIVABLE_TIMING");
    })());
  }

  console.log("Static safety (Phase 40) + knowledge contract (Phase 33)");
  {
    const PURE = ["lib/partner/memory/types.ts", "lib/partner/memory/core.ts", "lib/partner/memory/preflight.ts", "lib/partner/memory/contract.ts"];
    ok("62. memory modules are read-only: no Supabase, no insert/update/delete/upsert/rpc, no fetch, no clock", PURE.every((f) => !/lib\/supabase|@supabase|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(|new Date\(\)|Date\.now\(/.test(strip(rd(f)))));
    ok("62b. memory never imports a mutation primitive (Owner Context append, Action decide/execute, feedback, baseline, push, cron, alerts)", [...PURE, "lib/partner/memory/server.ts"].every((f) => !/appendOwnerContext|appendDecision|callExecuteRpc|executeApprovedAction|decideSuggestedAction|changeSuggestedActionValue|feedback\/store|savePartnerBaseline|web-push|lib\/push|node-cron|alerts-store|agent_alerts|answer-service/.test(strip(rd(f)))));
    const srv = strip(rd("lib/partner/memory/server.ts"));
    ok("62c. the server binding only READS (listOwnerContexts, getEventsByType, listExecutedActionOutcomes, loadFinanceLive)", /^import "server-only";/m.test(rd("lib/partner/memory/server.ts")) && /listOwnerContexts\(\)/.test(srv) && /getEventsByType\(t\)/.test(srv) && /listExecutedActionOutcomes\(\)/.test(srv) && !/actionEventStore\.(appendDecision|callExecuteRpc)/.test(srv));
    check("33. the knowledge contract covers EVERY Owner-question type (compile-time Record + runtime check)", Object.keys(PARTNER_KNOWLEDGE_CONTRACT).sort(), Object.keys(ANSWER_OPTIONS).sort());
    ok("33b. every contract entry answers all ten questions", Object.values(PARTNER_KNOWLEDGE_CONTRACT).every((c) => [c.learns, c.entity, c.epistemic, c.temporality, c.reuse, c.duplicateGuard, c.invalidatedBy, c.liveOverride].every((x) => typeof x === "string" && x.length > 3) && ("patternEvidence" in c) && ("actionLink" in c)));
    ok("the Owner Context answer endpoint remains the only Owner Context writer for finance", fs.readdirSync(path.join(ROOT, "lib/partner/finance")).filter((f) => /import \{ appendOwnerContext \}/.test(fs.readFileSync(path.join(ROOT, "lib/partner/finance", f), "utf8"))).join() === "answer-service.ts" && fs.readdirSync(path.join(ROOT, "lib/partner/memory")).every((f) => !/appendOwnerContext/.test(fs.readFileSync(path.join(ROOT, "lib/partner/memory", f), "utf8"))));
  }

  const self = fs.readFileSync(__filename, "utf8");
  ok("this test never imports a production binding", !/^import .* from ["'][^"']*(lib\/supabase|memory\/server|finance\/server|context-store|event-store|outcome-server)["'];$/m.test(self));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
